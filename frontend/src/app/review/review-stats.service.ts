import { Injectable, computed, inject } from '@angular/core';
import { ReviewFeedService } from './review-feed.service';
import { ReviewDecisionsService } from './review-decisions.service';
import { PreferencesService } from '../preferences.service';
import { Photo } from '../photo';

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

  /** How many units have a verdict today (anything out of backlog), and whether the run is complete. */
  readonly doneToday = computed(
    () => this.feed.photos().filter((p) => p.status !== 'backlog').length,
  );
  readonly sessionDone = computed(() => this.doneToday() === this.feed.photos().length);

  // Per-verdict tallies for the session summary.
  readonly keptCount = computed(() => this.feed.photos().filter((p) => p.status === 'kept').length);
  readonly rejectedCount = computed(
    () => this.feed.photos().filter((p) => p.status === 'rejected').length,
  );
  readonly toEditCount = computed(
    () => this.feed.photos().filter((p) => p.status === 'toEdit').length,
  );
  readonly maybeCount = computed(
    () => this.feed.photos().filter((p) => p.status === 'maybe').length,
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
