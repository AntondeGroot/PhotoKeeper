import { Injectable, computed, inject } from '@angular/core';
import { ReviewFeedService } from '../deck/review-feed.service';
import { ReviewDecisionsService } from '../decisions/review-decisions.service';
import { PreferencesService } from '../../preferences.service';
import { Photo } from '../../photo';
import { decidedPhotographs, photographsJudged } from './daily-tally';

/** Buckets photos by album for the Edit/Print "by album" sections (null album → "No album"). */
function groupByAlbum(photos: Photo[]): { album: string; photos: Photo[] }[] {
  const map = new Map<string, Photo[]>();
  for (const p of photos) {
    const key = p.album ?? 'No album';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(p);
  }
  return Array.from(map.entries()).map(([album, photos]) => ({ album, photos }));
}

/**
 * The derived view of the review deck: per-verdict tallies, daily-goal progress, and the Edit/Print
 * queues (flat and grouped by album). Pure read-model — every member is a computed over the deck
 * ({@link ReviewFeedService}), the goals ({@link PreferencesService}), and the session's edit count
 * ({@link ReviewDecisionsService}); it holds no state and never mutates anything.
 */
@Injectable({ providedIn: 'root' })
export class ReviewStatsService {
  private readonly feed = inject(ReviewFeedService);
  private readonly decisions = inject(ReviewDecisionsService);
  private readonly prefs = inject(PreferencesService);

  /**
   * How many photographs have been judged today — a burst counts each of its frames (see
   * {@link photographsJudged}) — and whether the deck has nothing left undecided.
   */
  readonly doneToday = computed(() => decidedPhotographs(this.feed.photos()));
  readonly sessionDone = computed(() => this.feed.photos().every((p) => p.status !== 'backlog'));

  // Per-verdict tallies for the session summary.
  readonly keptCount = computed(() => this.feed.photos().filter((p) => p.status === 'kept').length);
  // Weighted like the day's tally, so a burst's rejected frames show up here as photographs too.
  readonly rejectedCount = computed(() =>
    this.feed
      .photos()
      .filter((p) => p.status === 'rejected')
      .reduce((sum, p) => sum + photographsJudged(p), 0),
  );
  readonly toEditCount = computed(
    () => this.feed.photos().filter((p) => p.status === 'toEdit').length,
  );
  readonly maybeCount = computed(
    () => this.feed.photos().filter((p) => p.status === 'maybe').length,
  );

  /** Units still undecided — the "pile waiting" the reminder nudges are about. */
  readonly backlogCount = computed(
    () => this.feed.photos().filter((p) => p.status === 'backlog').length,
  );

  /** Progress against the daily sorting / editing goals (clamped to 100%). */
  readonly progressReviewPercent = computed(() =>
    Math.min(100, (this.doneToday() / this.prefs.dailyGoal()) * 100),
  );
  readonly progressEditPercent = computed(() =>
    Math.min(100, (this.decisions.editedToday() / this.prefs.editGoal()) * 100),
  );

  /** The Edit step's queue (single photos marked toEdit) and whether editing is done for the day. */
  readonly toEditQueue = computed(() =>
    this.feed.photos().filter((p): p is Photo => p.kind === 'photo' && p.status === 'toEdit'),
  );

  /** Today's edit batch: the first {@link PreferencesService.editGoal} of the queue — a focused set to
   *  edit today, rather than the whole backlog. The full queue still drives the Prints-tab overview. */
  readonly editBatch = computed(() => this.toEditQueue().slice(0, this.prefs.editGoal()));
  readonly editDone = computed(
    () => this.decisions.editedToday() >= this.prefs.editGoal() || this.toEditQueue().length === 0,
  );

  /** The Print pool (single photos promoted to print), and both queues grouped by album. */
  readonly toPrintQueue = computed(() =>
    this.feed.photos().filter((p): p is Photo => p.kind === 'photo' && p.status === 'toPrint'),
  );
  readonly toEditByAlbum = computed(() => groupByAlbum(this.toEditQueue()));
  readonly toPrintByAlbum = computed(() => groupByAlbum(this.toPrintQueue()));
}
