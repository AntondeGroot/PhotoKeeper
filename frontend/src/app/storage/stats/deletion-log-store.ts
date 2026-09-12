import { Injectable, inject } from '@angular/core';
import { DeletionRecord } from '../../stats/census';
import { PhotoKeeperDb } from '../photokeeper-db';

/**
 * Every photograph seen to have been deleted in Lightroom, and when it was first seen.
 *
 * Kept because the catalogue itself forgets: a deleted photo leaves a tombstone that is purged after
 * thirty days, after which Lightroom can no longer be asked whether that photograph ever existed.
 * Anything counting deletions from what the albums currently hold would therefore count down as well
 * as up. This is the ledger that only grows, and like the census it is a record rather than a cache,
 * so it is never cleared by a version bump.
 */
@Injectable({ providedIn: 'root' })
export class DeletionLogStore {
  private readonly db = inject(PhotoKeeperDb);

  /**
   * Writes down the ones not already on record, and says how many were new.
   *
   * First sighting wins: the same tombstone is seen by every check that runs in those thirty days,
   * and the day worth keeping is the one it was first noticed — rewriting it would move every
   * deletion forward to today and flatten the history into a single spike.
   */
  async noteAll(assetIds: Iterable<string>, album: string, day: string): Promise<number> {
    const db = await this.db.open();
    const tx = db.transaction('deletionLog', 'readwrite');
    let added = 0;
    for (const assetId of assetIds) {
      if (await tx.store.get(assetId)) continue;
      await tx.store.put({ day, album, at: Date.now() }, assetId);
      added++;
    }
    await tx.done;
    return added;
  }

  /** How many deletions have been seen in all — the cumulative figure the chart draws. */
  async count(): Promise<number> {
    return (await this.db.open()).count('deletionLog');
  }

  /** Every deletion on record, so a chart can place them on the days they were first seen. */
  async all(): Promise<Map<string, DeletionRecord>> {
    const db = await this.db.open();
    const keys = await db.getAllKeys('deletionLog');
    const values = await db.getAll('deletionLog');
    const map = new Map<string, DeletionRecord>();
    keys.forEach((key, i) => map.set(key, values[i]));
    return map;
  }
}
