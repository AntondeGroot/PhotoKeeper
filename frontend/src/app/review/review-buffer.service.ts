import { Injectable, computed, inject, signal } from '@angular/core';
import { ReviewItem, unitAssetIds } from '../photo';
import { PreferencesService } from '../preferences.service';
import { ReviewBufferStore } from '../storage/review/review-buffer-store';
import { ReviewStore } from '../storage/review/review-store';
import { DailyUnitsService } from './selection/daily-units.service';
import { PreviewCacheService } from './preview-cache.service';
import { REVIEW_BUFFER_TARGET as TARGET } from './review-buffer-target';

/**
 * How far the queue may fall before it is worth saying so — two batches' worth.
 *
 * Not one batch: taking a batch drops the queue by fifteen every time, and the refill that follows
 * puts them straight back, so a tighter threshold would blink on and off through an ordinary
 * session and mean nothing. Falling two batches behind means the refills are not keeping up, which
 * is the thing worth seeing.
 */
const LOW_WATER = TARGET - 30;

/**
 * A standing queue of review units that have not been seen, kept full in the background.
 *
 * The queue exists because finding photos is a *search*, not a lookup. The sampler draws
 * album-weighted across the whole library and knows nothing about what has been reviewed, so the
 * decided ones are dropped afterwards. Early on almost everything drawn is new; once most of the
 * library is sorted, a draw of forty-five can yield two. That is the wrong way round — the harder a
 * session is worked, the less "review more" hands back.
 *
 * Filling ahead of time moves that search off the tap. Asking for more is then a slice off the
 * front, always a full batch, and the refill happens where being slow costs nothing.
 *
 * Two parts, deliberately:
 *
 * - the **queue** — up to {@link TARGET} units, metadata only, cheap to hold and cheap to refill;
 * - the **warm front** — the next batch's worth (one daily goal), whose previews are pulled into
 *   the durable store so the batch they become opens instantly.
 *
 * Downloading previews for all two hundred would be a great deal of data for photos that may not be
 * looked at for weeks, so only the front is warmed, and it advances as the queue is consumed.
 */
@Injectable({ providedIn: 'root' })
export class ReviewBufferService {
  private readonly store = inject(ReviewBufferStore);
  private readonly reviewStore = inject(ReviewStore);
  private readonly dailyUnits = inject(DailyUnitsService);
  private readonly previews = inject(PreviewCacheService);
  private readonly prefs = inject(PreferencesService);

  private readonly queue = signal<ReviewItem[]>([]);
  private loaded = false;

  /** Units waiting. Zero *after* a refill means the library is genuinely exhausted. */
  readonly available = computed(() => this.queue().length);

  /** How full the queue is, as a percentage of {@link TARGET}. */
  readonly fillPercent = computed(() => Math.round((this.queue().length / TARGET) * 100));

  /**
   * Whether to show the queue's state at all.
   *
   * Deliberately sticky: it turns on when the queue falls below {@link LOW_WATER} and turns off
   * only once it is full again, rather than tracking the threshold in both directions. A flag that
   * flipped at one level would sit there flickering while the queue hovered around it, and the
   * useful question is not "is it low right now" but "has it recovered yet".
   */
  readonly low = signal(false);

  /** Assets whose previews have been fetched ahead — the warm front, which eviction must spare. */
  warmedIds(): string[] {
    return this.queue().slice(0, this.prefs.dailyGoal()).flatMap(unitAssetIds);
  }

  /** Reads the stored queue once per session. */
  private async hydrate(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    const stored = await this.store.get().catch(() => []);
    this.queue.set(stored);
    this.updateLow(stored.length);
  }

  /**
   * Takes up to `count` units off the front, skipping any that have been decided since they were
   * queued — the queue is a snapshot, and a photo can be reviewed from today's deck while it sits
   * in here.
   */
  async take(count: number, exclude: ReadonlySet<string> = new Set()): Promise<ReviewItem[]> {
    try {
      return await this.takeFront(count, exclude);
    } catch {
      return []; // storage unavailable — the caller falls back to sampling
    }
  }

  private async takeFront(count: number, exclude: ReadonlySet<string>): Promise<ReviewItem[]> {
    await this.hydrate();
    const verdicts = await this.reviewStore.getVerdicts();
    const stale = (unit: ReviewItem): boolean =>
      unitAssetIds(unit).some(
        (id) => exclude.has(id) || (verdicts.get(id)?.status ?? 'backlog') !== 'backlog',
      );

    const usable = this.queue().filter((unit) => !stale(unit));
    const taken = usable.slice(0, count);
    await this.persist(usable.slice(taken.length));
    return taken;
  }

  /**
   * Tops the queue back up and warms the front. Safe to call and forget — it is the slow half, and
   * nothing waits on it.
   */
  async refill(exclude: ReadonlySet<string> = new Set()): Promise<void> {
    try {
      await this.topUp(exclude);
    } catch {
      // Best-effort by design: this is fired and forgotten, so a failure must go nowhere. The
      // buffer stays as it is and the next take falls back to sampling.
    }
  }

  private async topUp(exclude: ReadonlySet<string>): Promise<void> {
    await this.hydrate();
    const missing = TARGET - this.queue().length;
    if (missing > 0) {
      const held = new Set(this.queue().flatMap(unitAssetIds));
      const fresh = await this.sample(missing, new Set([...held, ...exclude]));
      if (fresh.length > 0) await this.persist([...this.queue(), ...fresh]);
      // Coming back short means the library is out of unseen photos, not that the queue has fallen
      // behind. There is nothing left to queue and nothing the user could do about it, so the
      // indicator stands down rather than reporting a shortfall that will never close.
      if (fresh.length < missing) this.low.set(false);
    }
    await this.warmFront();
  }

  /** Pulls previews for the next batch into the durable store, so it opens without a wait. */
  private async warmFront(): Promise<void> {
    for (const unit of this.queue().slice(0, this.prefs.dailyGoal())) {
      for (const id of unitAssetIds(unit)) {
        await this.previews.warmDurable(id);
      }
    }
  }

  /** Draws unseen units, over-sampling so the decided ones can be dropped and still come back full. */
  private async sample(count: number, exclude: ReadonlySet<string>): Promise<ReviewItem[]> {
    const verdicts = await this.reviewStore.getVerdicts();
    const isFresh = (unit: ReviewItem): boolean =>
      unitAssetIds(unit).every(
        (id) => !exclude.has(id) && (verdicts.get(id)?.status ?? 'backlog') === 'backlog',
      );

    const drawn = await this.dailyUnits.buildUnits(this.prefs.vacationAlbumIds(), count * 3);
    return drawn.filter(isFresh).slice(0, count);
  }

  private async persist(units: ReviewItem[]): Promise<void> {
    this.queue.set(units);
    this.updateLow(units.length);
    await this.store.set(units);
  }

  private updateLow(size: number): void {
    if (size >= TARGET) this.low.set(false);
    else if (size <= LOW_WATER) this.low.set(true); // inclusive: exactly two batches behind counts
  }
}
