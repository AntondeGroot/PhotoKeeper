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
function dateKey(d: Date): string {
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

  // The review queue, starting on mock data until real photos load. The cursor, whether photos have
  // loaded, and whether more can be sampled.
  readonly photos = signal<ReviewItem[]>([...MOCK_PHOTOS, MOCK_BURST, MOCK_PANO, MOCK_STEREO]);
  readonly index = signal(0);
  readonly loaded = signal(false);
  readonly canLoadMore = signal(true);

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
      photos = await this.selectUnits();
      if (photos.length > 0) await this.reviewStore.setDailyFeed(today, photos);
    }
    if (photos.length === 0) return;

    // Device photos aren't persisted in the feed — they're rebuilt from settings each load.
    const verdicts = await this.reviewStore.getVerdicts();
    const deck = [...photos, ...this.deviceDeck()];
    const withVerdicts = deck.map((p) => this.applyVerdict(p, verdicts.get(p.id)));
    this.photos.set(withVerdicts);
    const firstUndone = withVerdicts.findIndex((p) => p.status === 'backlog');
    this.index.set(firstUndone === -1 ? 0 : firstUndone);
    this.loaded.set(true);
    this.canLoadMore.set(true);

    // Drop previews + stored selections from earlier days, keeping today AND tomorrow (precomputed).
    const keep = new Set(withVerdicts.map((p) => p.id));
    const tomorrow = await this.reviewStore.getDailyFeed(tomorrowKey());
    tomorrow?.forEach((p) => keep.add(p.id));
    void this.previews.evictDurableExcept(keep);
    void this.reviewStore.pruneDailyFeedExcept(new Set([today, tomorrowKey()]));
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
   * Warm-ahead: pick tomorrow's selection and fetch its previews into the durable store now, so opening
   * the app tomorrow needs no sample and no downloads. Idempotent + best-effort.
   */
  async precomputeTomorrow(): Promise<void> {
    try {
      const tomorrow = tomorrowKey();
      let units = await this.reviewStore.getDailyFeed(tomorrow);
      if (!units) {
        units = await this.selectUnits();
        if (units.length === 0) return;
        await this.reviewStore.setDailyFeed(tomorrow, units);
      }
      for (const unit of units) {
        for (const id of unitAssetIds(unit)) {
          await this.previews.warmDurable(id);
        }
      }
    } catch {
      // Precompute is best-effort; never surface an error to the user.
    }
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
  private async selectUnits(limit: number = this.prefs.dailyGoal()): Promise<ReviewItem[]> {
    const vacation = this.prefs.vacationAlbumIds();
    const units = await this.dailyUnits.buildUnits(vacation, limit);
    if (units.length > 0) return units;
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
