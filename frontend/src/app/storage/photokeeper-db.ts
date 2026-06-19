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

/** Kinds of detected group. Burst + pano are produced; stereo awaits its detector. */
export type GroupType = 'burst' | 'pano' | 'stereo';

/** A panorama's pan axis: left↔right (horizontal) or top↔bottom (vertical). */
export type PanoOrientation = 'horizontal' | 'vertical';

/**
 * A whole-frame grayscale signature (SIGNATURE_SIZE² bytes, row-major) for pano detection. The matcher
 * slides one frame's signature over the next to find their overlap, so it works at any overlap amount.
 */
export type FrameSignature = Uint8Array;

/** A detected cluster of assets, ready to hydrate into a `ReviewItem` for group-aware selection. */
export interface DetectedGroup {
  type: GroupType;
  sourceAlbumId: string;
  memberIds: string[];
  orientation?: PanoOrientation; // only set for pano groups
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
 * A user correction: "this detected group is not actually a group" (or "I want these reviewed
 * separately"). Keyed by its member set so selection drops the group — its frames become singles —
 * and it survives re-scans. Records no calibration signal: a dissolve doesn't reliably mean detection
 * was wrong, so it isn't used to tune thresholds.
 */
export interface GroupOverride {
  memberIds: string[];
  dissolvedAt: number; // epoch ms
}

/**
 * A user correction of a group's *type*: "this burst is actually a pano" (or vice-versa). Keyed by its
 * member set like {@link GroupOverride}, so it survives reloads + re-scans. Selection re-types the
 * detected group before hydrating it. Records no calibration signal (a relabel doesn't pin a threshold).
 */
export interface GroupReclass {
  memberIds: string[];
  type: GroupType;
  orientation?: PanoOrientation; // for a pano relabel; defaults to horizontal when re-typing a burst
  at: number; // epoch ms
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
 * - groupOverrides: member-set signature → a "not a group" user correction
 * - groupReclass: member-set signature → a "this is actually a burst/pano" user correction
 * - frameSignature: assetId → grayscale signature (Uint8Array), the pano matcher's input
 * - frameAspect: assetId → rendition width/height, the pano aspect gate's input
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
  groupOverrides: { key: string; value: GroupOverride };
  groupReclass: { key: string; value: GroupReclass };
  frameSignature: { key: string; value: FrameSignature };
  frameAspect: { key: string; value: number };
}

/** Opens (once) and hands out the app's IndexedDB database. */
@Injectable({ providedIn: 'root' })
export class PhotoKeeperDb {
  private dbPromise: Promise<IDBPDatabase<PhotoKeeperSchema>> | null = null;

  open(): Promise<IDBPDatabase<PhotoKeeperSchema>> {
    // v2–v8 grew the store set (see history). v9 replaced the fixed 'edgeHash' store with
    // 'frameSignature'. v10 added 'frameAspect' (the aspect gate's input) and clears signatures +
    // manifests so every album re-scans. v11 added 'groupReclass' (burst↔pano user corrections).
    // Create-if-missing so other stores keep their data.
    this.dbPromise ??= openDB<PhotoKeeperSchema>('photokeeper', 11, {
      upgrade(db, oldVersion, _newVersion, tx) {
        // 'edgeHash' is gone from the schema; drop it via a loosely-typed handle if a dev DB still has it.
        const legacy = db as unknown as IDBPDatabase;
        if (legacy.objectStoreNames.contains('edgeHash')) legacy.deleteObjectStore('edgeHash');
        // The v10 re-hash (drop signatures, clear manifests) only applies to DBs older than v10.
        if (oldVersion < 10 && db.objectStoreNames.contains('frameSignature')) {
          db.deleteObjectStore('frameSignature');
        }
        for (const store of [
          'previews',
          'verdicts',
          'dailyFeed',
          'albumTags',
          'assetHash',
          'albumManifest',
          'groups',
          'assetMeta',
          'groupOverrides',
          'groupReclass',
          'frameSignature',
          'frameAspect',
        ] as const) {
          if (!db.objectStoreNames.contains(store)) {
            db.createObjectStore(store);
          }
        }
        if (oldVersion < 10 && db.objectStoreNames.contains('albumManifest')) {
          void tx.objectStore('albumManifest').clear();
        }
      },
    });
    return this.dbPromise;
  }
}
