import { Injectable, computed, inject, signal } from '@angular/core';
import { SafeUrl } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import { LightroomService } from '../lightroom.service';
import { PhotoAsset } from '../lightroom-types';
import { ReviewStore } from '../storage/review/review-store';
import { StoredVerdict } from '../storage/photokeeper-db';
import { DailyUnitsService } from './selection/daily-units.service';
import { PreviewCacheService } from './preview-cache.service';
import { PreferencesService } from '../preferences.service';
import { ReviewBufferService } from './review-buffer.service';
import {
  DEVICE_PHOTOS,
  MOCK_BURST,
  MOCK_PANO,
  MOCK_PHOTOS,
  MOCK_STEREO,
  Photo,
  ReviewItem,
  isDevicePhoto,
  splitFileName,
  unitAssetIds,
} from '../photo';

/** Local-date key (YYYY-MM-DD), so the daily selection doesn't flip a day early/late at UTC midnight. */
export function dateKey(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

export function todayKey(): string {
  return dateKey(new Date());
}

export function tomorrowKey(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return dateKey(d);
}

/**
 * The header's date line, e.g. "Tuesday 9 June".
 *
 * <p>Fixed to en-GB rather than the device locale: the rest of the interface is written in English,
 * and a Dutch weekday under an English wordmark reads as a bug rather than as localisation. When the
 * app is actually translated, this should follow whatever that chooses.
 */
export function dayLabel(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(d);
}

/**
 * Owns the review deck and how it's filled: today's selection (cached or freshly sampled on-device,
 * falling back to the server feed), plus the enabled device photos, with stored verdicts overlaid. Also
 * warms tomorrow's selection ahead of time and reconciles device photos when the source settings change.
 * The deck signals are mutated in place by the host's review decisions; this service is the loading +
 * sampling layer behind them.
 */
@Injectable({ providedIn: 'root' })
export class ReviewFeedService {
  private readonly svc = inject(LightroomService);
  private readonly reviewStore = inject(ReviewStore);
  private readonly dailyUnits = inject(DailyUnitsService);
  private readonly previews = inject(PreviewCacheService);
  private readonly prefs = inject(PreferencesService);
  private readonly buffer = inject(ReviewBufferService);

  // The review queue, starting on mock data until real photos load. The cursor, whether photos have
  // loaded, and whether more can be sampled.
  readonly photos = signal<ReviewItem[]>([...MOCK_PHOTOS, MOCK_BURST, MOCK_PANO, MOCK_STEREO]);
  // The day the review belongs to, spelled out for the header. This service already decides where a
  // day starts (see dateKey), so it is the one place that should answer "which day is this".
  readonly todayLabel = dayLabel(new Date());
  readonly index = signal(0);
  readonly loaded = signal(false);
  readonly canLoadMore = signal(true);

  /**
   * True when there is nothing left to review anywhere — not "today's batch is done", but "the
   * library is done".
   *
   * The two look identical from the deck: an empty deck makes `sessionDone` trivially true (0 of 0
   * decided), so a finished library showed the "all caught up" screen reporting a session that
   * never happened, complete with a celebration for work not done.
   */
  readonly nothingToReview = signal(false);

  /** The unit at the cursor. */
  current(): ReviewItem | undefined {
    return this.photos()[this.index()];
  }

  /** Advance the cursor to the next unit (bounded). */
  advance(): void {
    if (this.index() < this.photos().length - 1) this.index.update((i) => i + 1);
  }

  /** Step the cursor back (bounded). */
  back(): void {
    if (this.index() > 0) this.index.update((i) => i - 1);
  }

  /** The current unit's preview URL when it's a single photo (null otherwise). Reacts as previews load. */
  readonly currentUrl = computed(() => {
    const current = this.current();
    return current?.kind === 'photo' ? this.previews.url(current.id) : null;
  });

  /** Frame-id → preview URL for the current unit (e.g. a burst's frames), passed to the group cards. */
  readonly currentUnitUrls = computed(() => {
    const current = this.current();
    const urls = new Map<string, SafeUrl>();
    for (const id of current ? unitAssetIds(current) : []) {
      const url = this.previews.url(id);
      if (url) urls.set(id, url);
    }
    return urls;
  });

  /**
   * Loads today's deck: reuse today's already-chosen selection if present, else sample a fresh one and
   * store it (so the same units come back across reloads). Appends enabled device photos, overlays
   * stored verdicts, resumes at the first un-reviewed unit, and prunes stale previews/selections.
   * Throws on failure — the caller surfaces the error.
   */
  async loadToday(): Promise<void> {
    const today = todayKey();
    let photos = await this.reviewStore.getDailyFeed(today);
    if (!photos) {
      // Off the buffer, whose front was warmed during the last session — that is what makes the
      // first session of a day open instantly, and it is the job the tomorrow-precompute did.
      photos = await this.buffer.take(this.prefs.dailyGoal());
      if (photos.length === 0) photos = await this.selectUnits(); // buffer empty or unavailable
      if (photos.length > 0) await this.reviewStore.setDailyFeed(today, photos);
    }
    if (photos.length === 0) {
      this.nothingToReview.set(true);
      this.canLoadMore.set(false);
      this.loaded.set(true);
      return;
    }
    this.nothingToReview.set(false);

    // Device photos aren't persisted in the feed — they're rebuilt from settings each load.
    const verdicts = await this.reviewStore.getVerdicts();
    const deck = [...photos, ...this.deviceDeck()];
    const withVerdicts = deck.map((p) => this.applyVerdict(p, verdicts.get(p.id)));
    this.photos.set(withVerdicts);
    const firstUndone = withVerdicts.findIndex((p) => p.status === 'backlog');
    this.index.set(firstUndone === -1 ? 0 : firstUndone);
    this.loaded.set(true);
    this.canLoadMore.set(true);

    // Stock the buffer behind the first paint, so the first "review more" is already a slice.
    void this.buffer.refill(new Set(deck.flatMap(unitAssetIds)));

    // Drop previews + stored selections from earlier days. Today's deck is kept, and so is the
    // buffer's warm front — those previews were fetched precisely so the next batch opens without
    // a wait, and evicting them here would undo that work on every start.
    const keep = new Set(withVerdicts.map((p) => p.id));
    this.buffer.warmedIds().forEach((id) => keep.add(id));
    void this.previews.evictDurableExcept(keep);
    void this.reviewStore.pruneDailyFeedExcept(new Set([today]));
  }

  /**
   * Appends a fresh batch of unseen units when the user is caught up but wants to keep going. Samples
   * generously and keeps only units no asset of which is already queued or already decided; when nothing
   * new remains the population is exhausted and {@link canLoadMore} goes false.
   */
  async loadMore(): Promise<void> {
    const verdicts = await this.reviewStore.getVerdicts();
    const inQueue = new Set(this.photos().flatMap(unitAssetIds));
    const isFresh = (unit: ReviewItem): boolean =>
      unitAssetIds(unit).every(
        (id) => !inQueue.has(id) && (verdicts.get(id)?.status ?? 'backlog') === 'backlog',
      );

    const goal = this.prefs.dailyGoal();
    const more = (await this.selectUnits(goal * 3)).filter(isFresh).slice(0, goal);
    if (more.length === 0) {
      this.canLoadMore.set(false);
      return;
    }
    // Insert ahead of any device photos, and persist only the Lightroom feed (device is rebuilt).
    const base = this.photos().filter((p) => !isDevicePhoto(p));
    const newBase = [...base, ...more];
    void this.reviewStore.setDailyFeed(todayKey(), newBase);
    this.photos.set(newBase);
    await this.refreshDeviceDeck();
    const next = this.photos().findIndex((p) => p.status === 'backlog');
    if (next !== -1) this.index.set(next);
  }

  /**
   * Discards every cached daily selection so the next {@link loadToday} re-samples from scratch — used
   * after the daily goal changes, where the stored selection no longer matches the requested size.
   */
  async clearDailySelections(): Promise<void> {
    await this.reviewStore.pruneDailyFeedExcept(new Set());
  }

  /**
   * Reconciles the device photos in the deck with the current device settings: strips the existing
   * device photos and re-appends the ones the settings now call for (verdicts overlaid), keeping the
   * Lightroom photos and the review index intact.
   */
  async refreshDeviceDeck(): Promise<void> {
    const verdicts = await this.reviewStore.getVerdicts();
    const base = this.photos().filter((p) => !isDevicePhoto(p));
    const device = this.deviceDeck().map((p) => this.applyVerdict(p, verdicts.get(p.id)));
    const deck = [...base, ...device];
    this.photos.set(deck);
    if (this.index() >= deck.length) this.index.set(Math.max(0, deck.length - 1));
  }

  /** Chooses the review queue on-device from scanned metadata + detected groups, server feed as fallback. */
  /**
   * Samples `limit` units worth showing — nothing already decided.
   *
   * The sampler is blind to verdicts: it draws album-weighted over every asset it knows, so without
   * this a batch quietly fills with photos already reviewed. They arrive carrying their stored
   * verdict, count as done the moment the day opens, and take a slot each.
   *
   * Only the local sampler is over-drawn — it is in-memory and free, so taking three times the
   * batch leaves room to drop the decided ones and still come back full. The server fallback is the
   * pre-scan bootstrap, where nothing has been decided yet and a bigger request would just be a
   * bigger request.
   */
  private async selectUnits(limit: number = this.prefs.dailyGoal()): Promise<ReviewItem[]> {
    const vacation = this.prefs.vacationAlbumIds();
    const verdicts = await this.reviewStore.getVerdicts();
    const undecided = (unit: ReviewItem): boolean =>
      unitAssetIds(unit).every((id) => (verdicts.get(id)?.status ?? 'backlog') === 'backlog');

    const units = await this.dailyUnits.buildUnits(vacation, limit * 3);
    if (units.length > 0) return units.filter(undecided).slice(0, limit);
    const data = await firstValueFrom(this.svc.getFeed(vacation, limit));
    return (data?.resources ?? [])
      .filter((a) => a.subtype === 'image')
      .map((a) => this.assetToPhoto(a));
  }

  /** The enabled-folder device photos that belong in the deck right now (empty if device is off). */
  private deviceDeck(): Photo[] {
    const ready = this.prefs.deviceEnabled() && this.prefs.deviceFolders().some((f) => f.enabled);
    if (!ready) return [];
    const on = new Set(
      this.prefs
        .deviceFolders()
        .filter((f) => f.enabled)
        .map((f) => f.name),
    );
    return DEVICE_PHOTOS.filter((p) => p.album && on.has(p.album));
  }

  private applyVerdict(item: ReviewItem, verdict: StoredVerdict | undefined): ReviewItem {
    if (!verdict) return item;
    // starred/keepsake only exist on single photos; groups carry just a status.
    return item.kind === 'photo'
      ? { ...item, status: verdict.status, starred: verdict.starred, keepsake: verdict.keepsake }
      : { ...item, status: verdict.status };
  }

  private assetToPhoto(asset: PhotoAsset): Photo {
    const { name, ext } = splitFileName(asset.payload?.importSource?.fileName ?? asset.id);
    return {
      id: asset.id,
      name,
      ext,
      album: asset.album ?? null,
      taken: asset.payload?.captureDate ?? '',
      status: 'backlog',
      kind: 'photo',
      starred: false,
      keepsake: false,
    };
  }
}
