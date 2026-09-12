import { Injectable, inject } from '@angular/core';
import { PhotoKeeperDb } from '../photokeeper-db';

/** A merged photograph — a panorama, an HDR, or both — and the frames it was made from. */
export interface MergedPhotoRecord {
  /** The originals, kept so the sweep behind a panorama can always be found again. */
  frameIds: string[];
  /** When the merge was settled — the moment its sources left the edit queue. */
  at: number;
}

/**
 * Which merged photograph came from which frames.
 *
 * Kept because nothing else says so: the merge and its sweep are separate assets in Lightroom, tied
 * together by nothing but a filename — and a filename is a weak thread, since renaming either end
 * cuts it. Once the sources have left the edit queue there is no other record that those
 * photographs are the merge's originals.
 *
 * A record rather than a cache, so it is never cleared by a version bump.
 */
@Injectable({ providedIn: 'root' })
export class PhotoMergeStore {
  private readonly db = inject(PhotoKeeperDb);

  async get(mergedId: string): Promise<MergedPhotoRecord | undefined> {
    return (await this.db.open()).get('photoMerge', mergedId);
  }

  async record(mergedId: string, frameIds: readonly string[]): Promise<void> {
    await (
      await this.db.open()
    ).put('photoMerge', { frameIds: [...frameIds], at: Date.now() }, mergedId);
  }

  /** Every merge on record, merged asset id → the frames behind it. */
  async getAll(): Promise<Map<string, MergedPhotoRecord>> {
    const db = await this.db.open();
    const keys = await db.getAllKeys('photoMerge');
    const values = await db.getAll('photoMerge');
    const map = new Map<string, MergedPhotoRecord>();
    keys.forEach((key, i) => map.set(key, values[i]));
    return map;
  }

  /** Takes a merge off the record, for an undo of the decision that settled it. */
  async forget(mergedId: string): Promise<void> {
    await (await this.db.open()).delete('photoMerge', mergedId);
  }
}
