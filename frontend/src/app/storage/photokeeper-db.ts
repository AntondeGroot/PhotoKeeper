import { Injectable } from '@angular/core';
import { DBSchema, IDBPDatabase, openDB } from 'idb';
import { Photo, ReviewItem } from '../photo';
import { Tag } from '../tagging/tags';
import { AlbumPrintState } from '../prints/prints.types';
import { CurrentPick, ShownRecord } from '../celebrations/celebration.types';
import {
  DetectedGroup,
  FrameSignature,
  GroupType,
  PanoOrientation,
} from '../detection/detectors/detection-types';

export type ReviewStatus = Photo['status'];

/** A photo's review outcome, persisted so swipes survive a reload. */
export interface StoredVerdict {
  status: ReviewStatus;
  starred: boolean;
  /** Chosen on the Prints tab: keep the photo, but leave it out of the album's print order. */
  saveOnly: boolean;
}

/** How an album is classified. Room to grow (e.g. 'stereo') alongside 'vacation'. */
export type AlbumTag = 'vacation';

/** One asset's identity for change detection: its id plus the Lightroom `updated` revision stamp. */
export interface AssetFingerprint {
  id: string;
  updated: string;
}

/**
 * The lightweight per-asset metadata on-device selection needs to hydrate units without re-fetching
 * the album. Written by the background scan (which already holds the full asset list), so the
 * foreground feed build is a pure IndexedDB read.
 */
export interface AssetMeta {
  albumId: string;
  name: string; // display name without extension
  ext?: string; // original file extension without the dot, e.g. 'CR2'
  taken: string; // ISO 8601 capture time, '' if unknown
  lat?: number; // decimal GPS latitude, when the frame is geotagged (drone) — drives stereo baselines
  lng?: number; // decimal GPS longitude
  serial?: string; // camera body serial — keys twin-DSLR stereo left/right pairing (absent if none)
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
 * A user correction of a group's *membership*: "this panorama is missing frames" (or has one too
 * many). Keyed by the detected member set like the other two corrections, so it survives reloads and
 * re-scans; selection swaps the detected members for {@link GroupMembers.frameIds} before hydrating.
 *
 * Kept apart from {@link GroupReclass} because they answer different questions and can both hold at
 * once — a group can be re-typed *and* have a frame added, and merging them would make the second
 * correction overwrite the first.
 */
export interface GroupMembers {
  memberIds: string[]; // the detected group this correction was made about
  frameIds: string[]; // what the group actually consists of, in capture order
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
  // How many of the album's capture-time-sorted images have been scanned so far. The scan is
  // incremental (a soft per-pass image budget), so an album can be partially done: < total means
  // "resume here next pass". Absent on pre-cursor manifests → treated as 0 (re-scan from the start).
  scanned?: number;
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
 * - groupMembers: member-set signature → a "this pano is missing frames" user correction
 * - frameSignature: assetId → grayscale signature (Uint8Array), the pano matcher's input
 * - frameAspect: assetId → rendition width/height, the pano aspect gate's input
 * - tags: tagId → a user-defined content tag (the editable catalog)
 * - assetTags: assetId → the tag ids applied to that photo (the Tag-mode assignments)
 * - albumPrint: album name → its print-fulfilment state (ordered/placed) for the Prints tab
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
  groupMembers: { key: string; value: GroupMembers };
  frameSignature: { key: string; value: FrameSignature };
  frameAspect: { key: string; value: number };
  tags: { key: string; value: Tag };
  assetTags: { key: string; value: string[] };
  albumPrint: { key: string; value: AlbumPrintState };
  celebrationLog: { key: string; value: ShownRecord };
  celebrationCurrent: { key: string; value: CurrentPick };
  reviewBuffer: { key: string; value: ReviewItem[] };
}

/** Opens (once) and hands out the app's IndexedDB database. */
/**
 * Derived data that a code change invalidated, and the version that did it. On upgrade every entry
 * newer than the DB gets cleared, so each one only has to answer "what did this change make wrong?"
 *
 * Only ever caches and derived state — never anything the user produced. Verdicts, tags and print
 * state are absent by design: those are the record of somebody's work and are not rebuildable.
 */
const STALE_AT: readonly (readonly [number, readonly StaleStore[]])[] = [
  // v10: the aspect gate joined detection, so every album has to be looked at again.
  [10, ['albumManifest']],
  // v15–v17 reworked the perceptual hash (colour, then dead-banded colour, then luma), so stored
  // hashes no longer mean what the detectors think they mean.
  [17, ['assetHash', 'albumManifest']],
  // v21: review units are built once and then kept — a couple of hundred queued, plus the day's
  // deck. Both were assembled before edits were folded into the originals they came from, so
  // without this the change stays invisible until every unit built under the old rules is worked
  // through. The queue simply rebuilds itself.
  [21, ['reviewBuffer', 'dailyFeed']],
];

type StaleStore = 'albumManifest' | 'assetHash' | 'reviewBuffer' | 'dailyFeed';

@Injectable({ providedIn: 'root' })
export class PhotoKeeperDb {
  private dbPromise: Promise<IDBPDatabase<PhotoKeeperSchema>> | null = null;

  open(): Promise<IDBPDatabase<PhotoKeeperSchema>> {
    // v2–v8 grew the store set (see history). v9 replaced the fixed 'edgeHash' store with
    // 'frameSignature'. v10 added 'frameAspect' (the aspect gate's input) and clears signatures +
    // manifests so every album re-scans. v11 added 'groupReclass' (burst↔pano user corrections).
    // v12 added 'tags' (the user-defined content-tag catalog); v13 added 'assetTags' (Tag-mode
    // per-photo assignments); v14 added 'albumPrint' (the Prints tab's per-album fulfilment state).
    // v18 added 'celebrationLog' (which celebration images have been shown, and when); v19
    // added 'celebrationCurrent' (the pick standing for the current session, so a restart shows
    // the same picture). v20 added 'reviewBuffer' (units selected ahead of being needed). v21 clears
    // the queued units + stored decks, which were assembled before edits were folded into their
    // originals. v22 added 'groupMembers' (the frames a group actually has, after "this pano is
    // missing frames").
    // Create-if-missing so other stores keep their data.
    this.dbPromise ??= openDB<PhotoKeeperSchema>('photokeeper', 22, {
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
          'groupMembers',
          'frameSignature',
          'frameAspect',
          'tags',
          'assetTags',
          'albumPrint',
          'celebrationLog',
          'celebrationCurrent',
          'reviewBuffer',
        ] as const) {
          if (!db.objectStoreNames.contains(store)) {
            db.createObjectStore(store);
          }
        }

        for (const [version, stores] of STALE_AT) {
          if (oldVersion >= version) continue;
          for (const store of stores) {
            if (db.objectStoreNames.contains(store)) void tx.objectStore(store).clear();
          }
        }
      },
    });
    return this.dbPromise;
  }
}
