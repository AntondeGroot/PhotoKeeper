// Panorama detection: group runs of frames shot in quick succession that overlap at their edges —
// the signature of panning the camera across a scene.
//
// Unlike a burst (whole-frame near-duplicates), a pano's consecutive frames show *different* content
// that meets at a seam. A pan is either horizontal (one frame's right edge ≈ the next's left edge)
// or vertical (bottom ≈ top); never both. So we compare edge-strip hashes, and a run locks to the
// orientation its first overlapping pair establishes — once a horizontal seam is found we stop
// testing the vertical seam for that run, and vice-versa.
//
// Pure over metadata + cached edge hashes — no pixels, no network — so it's cheap to re-run and easy
// to test. The canvas glue that produces the edge hashes lives in `phash` (edgeHashImageBlob).

import { hammingDistance } from './phash';
import { PanoOrientation } from '../storage/photokeeper-db';

/** The minimum an asset must expose to be grouped into a pano. */
export interface PanoAsset {
  id: string;
  taken: string; // ISO 8601 capture time
  camera?: string; // optional; when absent, the camera check is skipped
}

/** Perceptual hashes of an asset's four edge strips (left/right for horizontal, top/bottom vertical). */
export interface EdgeHash {
  left: string;
  right: string;
  top: string;
  bottom: string;
}

export interface PanoCluster {
  memberIds: string[];
  orientation: PanoOrientation;
}

export interface PanoOptions {
  /** Max gap between consecutive frames to still count as one pan. */
  windowMs: number;
  /** Max Hamming distance between the matching edges of consecutive frames to count as overlapping. */
  maxEdgeHamming: number;
  /** Minimum frames for a run to qualify as a pano (≥ 2). */
  minSize: number;
}

/**
 * Groups `assets` into panoramas. `edges` maps assetId → its edge hashes; an asset without edge
 * hashes can't be confirmed to overlap, so it breaks a run (unlike burst detection, which groups
 * optimistically when a hash is missing). A run adopts the orientation of its first overlapping pair
 * and every later frame must keep meeting that same seam. Assets without a `taken` time are ignored.
 */
export function clusterPanos(
  assets: readonly PanoAsset[],
  edges: ReadonlyMap<string, EdgeHash>,
  opts: PanoOptions,
): PanoCluster[] {
  const ordered = assets
    .filter((a) => a.taken && !Number.isNaN(Date.parse(a.taken)))
    .sort((a, b) => Date.parse(a.taken) - Date.parse(b.taken));

  const clusters: PanoCluster[] = [];
  let run: PanoAsset[] = [];
  let orientation: PanoOrientation | null = null; // null until the run's first overlapping pair

  const flush = (): void => {
    if (run.length >= opts.minSize && orientation !== null) {
      clusters.push({ memberIds: run.map((a) => a.id), orientation });
    }
    run = [];
    orientation = null;
  };

  for (const asset of ordered) {
    if (run.length === 0) {
      run = [asset];
      continue;
    }
    const prev = run[run.length - 1];
    // Once the orientation is set, only that seam may extend the run; before then, either may start it.
    const seam = matchedSeam(prev, asset, edges, opts, orientation);
    if (seam) {
      run.push(asset);
      orientation = seam;
    } else {
      flush();
      run = [asset];
    }
  }
  flush();
  return clusters;
}

/**
 * The seam orientation on which `prev`→`next` overlap, or null if they don't. When `locked` is set
 * the run already has an orientation, so only that seam is tested (the other is never checked).
 */
function matchedSeam(
  prev: PanoAsset,
  next: PanoAsset,
  edges: ReadonlyMap<string, EdgeHash>,
  opts: PanoOptions,
  locked: PanoOrientation | null,
): PanoOrientation | null {
  const closeInTime = Date.parse(next.taken) - Date.parse(prev.taken) <= opts.windowMs;
  const sameCamera = (prev.camera ?? '') === (next.camera ?? '');
  if (!closeInTime || !sameCamera) return null;
  const ea = edges.get(prev.id);
  const eb = edges.get(next.id);
  if (ea === undefined || eb === undefined) return null; // no edge data → can't confirm a pano

  const max = opts.maxEdgeHamming;
  // Horizontal seam: prev's right meets next's left (or the reverse, panning the other way).
  if (locked !== 'vertical') {
    if (hammingDistance(ea.right, eb.left) <= max || hammingDistance(ea.left, eb.right) <= max) {
      return 'horizontal';
    }
  }
  // Vertical seam: prev's bottom meets next's top (or the reverse, tilting the other way).
  if (locked !== 'horizontal') {
    if (hammingDistance(ea.bottom, eb.top) <= max || hammingDistance(ea.top, eb.bottom) <= max) {
      return 'vertical';
    }
  }
  return null;
}
