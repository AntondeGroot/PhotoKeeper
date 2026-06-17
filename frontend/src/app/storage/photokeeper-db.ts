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
 * - previews:  `${assetId}:${size}` → preview image blob
 * - verdicts:  assetId → review outcome
 * - dailyFeed: 'YYYY-MM-DD' → the ordered photos chosen for that day (verdicts overlay on load)
 * - albumTags: albumId → tag
 * - assetHash: assetId → perceptual hash (hex), for burst/near-duplicate detection
 */
export interface PhotoKeeperSchema extends DBSchema {
  previews: { key: string; value: Blob };
  verdicts: { key: string; value: StoredVerdict };
  dailyFeed: { key: string; value: Photo[] };
  albumTags: { key: string; value: AlbumTag };
  assetHash: { key: string; value: string };
}

/** Opens (once) and hands out the app's IndexedDB database. */
@Injectable({ providedIn: 'root' })
export class PhotoKeeperDb {
  private dbPromise: Promise<IDBPDatabase<PhotoKeeperSchema>> | null = null;

  open(): Promise<IDBPDatabase<PhotoKeeperSchema>> {
    // v2 renamed the 'renditions' store to 'previews'; v3 added 'assetHash'. Create-if-missing so
    // existing dev databases keep their verdicts/dailyFeed/albumTags as new stores are added.
    this.dbPromise ??= openDB<PhotoKeeperSchema>('photokeeper', 3, {
      upgrade(db) {
        for (const store of [
          'previews',
          'verdicts',
          'dailyFeed',
          'albumTags',
          'assetHash',
        ] as const) {
          if (!db.objectStoreNames.contains(store)) {
            db.createObjectStore(store);
          }
        }
      },
    });
    return this.dbPromise;
  }
}
