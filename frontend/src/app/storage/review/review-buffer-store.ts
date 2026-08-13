import { Injectable, inject } from '@angular/core';
import { ReviewItem } from '../../photo';
import { PhotoKeeperDb } from '../photokeeper-db';

/** One queue, so it lives under a fixed key. */
const QUEUE_KEY = 'queue';

/**
 * Review units chosen ahead of being needed, so asking for more photos never waits on a search.
 *
 * Stored rather than held in memory: the search that fills it is the expensive part, and throwing
 * the result away on every app start would put that cost back on the first tap of the session.
 */
@Injectable({ providedIn: 'root' })
export class ReviewBufferStore {
  private readonly db = inject(PhotoKeeperDb);

  async get(): Promise<ReviewItem[]> {
    return (await (await this.db.open()).get('reviewBuffer', QUEUE_KEY)) ?? [];
  }

  async set(units: ReviewItem[]): Promise<void> {
    await (await this.db.open()).put('reviewBuffer', units, QUEUE_KEY);
  }
}
