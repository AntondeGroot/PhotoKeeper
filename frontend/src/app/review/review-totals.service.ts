import { Injectable, inject } from '@angular/core';
import { ReviewStore } from '../storage/review/review-store';
import { AlbumPrintStore } from '../storage/review/album-print-store';
import { CelebrationCounter } from '../celebrations/celebration.types';

/**
 * Lifetime totals of what the user has got through — how many photos reviewed, thrown out, flagged
 * for editing, and how many albums have made it to the wall.
 *
 * These are **derived, not tallied**. Every verdict is already persisted forever (that is how swipes
 * survive a reload), so the totals are a count of what is in the store rather than a set of counters
 * to keep in step with it. Nothing to increment means nothing to double-count when a verdict is
 * changed, nothing to migrate, and no way for the tallies to drift from the truth.
 *
 * The cost is reading the verdict map to answer, so this is for moments — the end of a session —
 * not for anything on a hot path.
 */
@Injectable({ providedIn: 'root' })
export class ReviewTotalsService {
  private readonly reviews = inject(ReviewStore);
  private readonly prints = inject(AlbumPrintStore);

  /** Lifetime counts, shaped for the celebration picker's milestone triggers. */
  async counters(): Promise<Partial<Record<CelebrationCounter, number>>> {
    const [verdicts, printed] = await Promise.all([
      this.reviews.getVerdicts(),
      this.prints.getAll(),
    ]);

    const statuses = [...verdicts.values()].map((v) => v.status);
    return {
      photosReviewed: statuses.length,
      photosDeleted: statuses.filter((s) => s === 'rejected').length,
      photosEdited: statuses.filter((s) => s === 'toEdit').length,
      // 'placed' means it arrived and went on the wall — the moment actually worth celebrating.
      albumsPrinted: [...printed.values()].filter((state) => state === 'placed').length,
    };
  }
}
