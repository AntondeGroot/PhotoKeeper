/**
 * Shared detection contract types — the persisted shapes the detector produces and selection consumes.
 * Pure domain (no Angular, no idb): they live here, not in the store schema, so detection/selection
 * logic and the stores that persist them can both depend on them without crossing a layer boundary.
 */

/** The kind of detected group. */
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
 * How an album takes part in stereo: `both` holds the two eyes of every shot, while `left` and
 * `right` each hold one eye and are half of a pair of albums (see docs/track-b-detection.md).
 */
export type StereoRole = 'both' | 'left' | 'right';
