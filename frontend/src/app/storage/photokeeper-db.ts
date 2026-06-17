import { Injectable } from '@angular/core';
import { DBSchema, IDBPDatabase, openDB } from 'idb';
import { Photo, ReviewItem } from '../photo';

export type ReviewStatus = Photo['status'];

/** A photo's review outcome, persisted so swipes survive a reload. */
export interface StoredVerdict {
  status: ReviewStatus;
  starred: boolean;
  keepsake: boolean;
}

/** How an album is classified. Room to grow (e.g. 'stereo') alongside 'vacation'. */
export type AlbumTag = 'vacation';

/** One asset's identity for change detection: its id plus the Lightroom `updated` revision stamp. */
export interface AssetFingerprint {
  id: string;
  updated: string;
}

/** Kinds of detected group. Only `burst` is produced today; pano/stereo await their detectors. */
export type GroupType = 'burst' | 'pano' | 'stereo';

/** A detected cluster of assets, ready to hydrate into a `ReviewItem` for group-aware selection. */
export interface DetectedGroup {
  type: GroupType;
  sourceAlbumId: string;
  memberIds: string[];
}

/**
 * The lightweight per-asset metadata on-device selection needs to hydrate units without re-fetching
 * the album. Written by the background scan (which already holds the full asset list), so the
 * foreground feed build is a pure IndexedDB read.
 */
export interface AssetMeta {
  albumId: string;
  name: string; // display name without extension
  taken: string; // ISO 8601 capture time, '' if unknown
}

/**
 * A snapshot of an album's asset population, written after each detection scan. The change-gate
 * hashes the current population and compares it against this; on a mismatch it diffs the fingerprint
 * lists to find exactly which assets were added/removed/changed, so only those get re-hashed.
 */
export interface AlbumManifest {
  hash: string; // hash over the sorted id+updated fingerprints; a quick "did anything change?" check
  fingerprints: AssetFingerprint[]; // sorted by id, for diffing when the hash differs
  computedAt: number; // epoch ms of the scan that produced this manifest
}

/**
 * On-device IndexedDB schema. Object stores use out-of-line keys (the key is passed explicitly):
 * - previews:  `${assetId}:${size}` → preview image blob
 * - verdicts:  assetId → review outcome
 * - dailyFeed: 'YYYY-MM-DD' → the ordered review units chosen for that day (verdicts overlay on load)
 * - albumTags: albumId → tag
 * - assetHash: assetId → perceptual hash (hex), for burst/near-duplicate detection
 * - albumManifest: albumId → population fingerprint, the detection change-gate
 * - groups: groupId → a detected cluster (burst/pano/stereo) for group-aware selection
 * - assetMeta: assetId → lightweight metadata for on-device selection (album, name, taken)
 */
export interface PhotoKeeperSchema extends DBSchema {
  previews: { key: string; value: Blob };
  verdicts: { key: string; value: StoredVerdict };
  dailyFeed: { key: string; value: ReviewItem[] };
  albumTags: { key: string; value: AlbumTag };
  assetHash: { key: string; value: string };
  albumManifest: { key: string; value: AlbumManifest };
  groups: { key: string; value: DetectedGroup };
  assetMeta: { key: string; value: AssetMeta };
}

/** Opens (once) and hands out the app's IndexedDB database. */
@Injectable({ providedIn: 'root' })
export class PhotoKeeperDb {
  private dbPromise: Promise<IDBPDatabase<PhotoKeeperSchema>> | null = null;

  open(): Promise<IDBPDatabase<PhotoKeeperSchema>> {
    // v2 renamed the 'renditions' store to 'previews'; v3 added 'assetHash'; v4 added
    // 'albumManifest'; v5 added 'groups'; v6 added 'assetMeta'. Create-if-missing so existing dev
    // databases keep their data.
    this.dbPromise ??= openDB<PhotoKeeperSchema>('photokeeper', 6, {
      upgrade(db) {
        for (const store of [
          'previews',
          'verdicts',
          'dailyFeed',
          'albumTags',
          'assetHash',
          'albumManifest',
          'groups',
          'assetMeta',
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
