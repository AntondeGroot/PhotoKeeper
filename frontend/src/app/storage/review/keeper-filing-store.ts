import { Injectable, inject } from '@angular/core';
import { FiledRecord, PhotoKeeperDb } from '../photokeeper-db';

/**
 * Which photos have been written back to a Keeper album, and which album each went to.
 *
 * Separate from the verdict on purpose. A verdict is what the user decided; this is what Lightroom
 * has been told, and the two are not the same fact — the second can lag the first by a network
 * failure, an unfinished album setup, or a session spent offline. Kept together in one record, a
 * later verdict write would erase the filing history and the app would file every photo again on
 * every launch.
 */
@Injectable({ providedIn: 'root' })
export class KeeperFilingStore {
  private readonly db = inject(PhotoKeeperDb);

  /** Everything filed so far, as assetId → the albums it has been put in. */
  async getAll(): Promise<Map<string, FiledRecord>> {
    const db = await this.db.open();
    const keys = await db.getAllKeys('keeperFiling');
    const values = await db.getAll('keeperFiling');
    const map = new Map<string, FiledRecord>();
    keys.forEach((key, i) => map.set(key, normalise(values[i])));
    return map;
  }

  /**
   * Adds an album to each photo's record, in one transaction.
   *
   * Added rather than replaced: a photo can be in several albums at once and cannot be taken out of
   * any of them, so the record has to accumulate the same way the albums do. Replacing would lose
   * the memory of where the photo still is, which is the only thing that makes tidying up possible.
   */
  async record(assetIds: readonly string[], album: string): Promise<void> {
    const db = await this.db.open();
    const tx = db.transaction('keeperFiling', 'readwrite');
    const at = Date.now();
    for (const id of assetIds) {
      const existing = normalise(await tx.store.get(id));
      const albums = existing.albums.includes(album)
        ? existing.albums
        : [...existing.albums, album];
      await tx.store.put({ albums, at }, id);
    }
    await tx.done;
  }
}

/**
 * A stored record in today's shape.
 *
 * Records written before this store tracked more than one album carry a single `album` string. Read
 * forward rather than migrated, because the alternative — clearing the store — would re-file every
 * decided photo in the catalogue to learn what it already knew.
 */
function normalise(stored: unknown): FiledRecord {
  const record = (stored ?? {}) as Partial<FiledRecord> & { album?: string };
  if (Array.isArray(record.albums)) return { albums: record.albums, at: record.at ?? 0 };
  return { albums: record.album ? [record.album] : [], at: record.at ?? 0 };
}
