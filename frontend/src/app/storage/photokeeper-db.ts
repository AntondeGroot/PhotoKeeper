import { Injectable } from '@angular/core';
import { DBSchema, IDBPDatabase, openDB } from 'idb';
import { Photo } from '../photo';

export type ReviewStatus = Photo['status'];

/** A photo's review outcome, persisted so swipes survive a reload. */
export interface StoredVerdict {
  status: ReviewStatus;
  starred: boolean;
  keepsake: boolean;
}

/** How an album is classified. Room to grow (e.g. 'stereo') alongside 'vacation'. */
export type AlbumTag = 'vacation';

/**
 * On-device IndexedDB schema. Object stores use out-of-line keys (the key is passed explicitly):
 * - renditions: `${assetId}:${size}` → image blob
 * - verdicts:   assetId → review outcome
 * - dailyFeed:  'YYYY-MM-DD' → the ordered photos chosen for that day (verdicts overlay on load)
 * - albumTags:  albumId → tag
 */
export interface PhotoKeeperSchema extends DBSchema {
  renditions: { key: string; value: Blob };
  verdicts: { key: string; value: StoredVerdict };
  dailyFeed: { key: string; value: Photo[] };
  albumTags: { key: string; value: AlbumTag };
}

/** Opens (once) and hands out the app's IndexedDB database. */
@Injectable({ providedIn: 'root' })
export class PhotoKeeperDb {
  private dbPromise: Promise<IDBPDatabase<PhotoKeeperSchema>> | null = null;

  open(): Promise<IDBPDatabase<PhotoKeeperSchema>> {
    this.dbPromise ??= openDB<PhotoKeeperSchema>('photokeeper', 1, {
      upgrade(db) {
        db.createObjectStore('renditions');
        db.createObjectStore('verdicts');
        db.createObjectStore('dailyFeed');
        db.createObjectStore('albumTags');
      },
    });
    return this.dbPromise;
  }
}
