// Panorama detection by sliding-overlap matching.
//
// A pano's consecutive frames pan across a scene: one frame's trailing edge continues into the next
// frame's leading edge, but by an *unknown* amount. A fixed-position edge hash can't see that — two
// strips at fixed coordinates sample different scene ranges unless the overlap happens to line up, so
// genuine overlaps score near random. Instead we keep a small grayscale signature per frame and
// *slide* one over the next, finding the offset (overlap width) where they best continue into each
// other. The score at that best offset says whether they really meet; the offset says by how much.
//
// Pure over metadata + cached signatures — no pixels, no network. The signatures come from `phash`
// (frameSignatureFromBlob).

import { SIGNATURE_SIZE, hammingDistance } from './phash';
import { PanoOrientation } from '../storage/photokeeper-db';

/**
 * Width of the fixed seam template, as a fraction of the frame — "the right 25% of one photo". The
 * template is taken from one frame's trailing edge and slid across the next frame; the gap it travels
 * is the overlap. So the smallest overlap this can find is one template width (frames must overlap by
 * at least this much for the trailing edge to still be inside the shared region).
 */
const BAND_FRACTION = 0.25;

/** The minimum an asset must expose to be grouped into a pano. */
export interface PanoAsset {
  id: string;
  taken: string; // ISO 8601 capture time
  camera?: string; // optional; when absent, the camera check is skipped
  aspect?: number; // width / height; when absent on either frame, the aspect gate is skipped
}

/**
 * Frames in one pano share an aspect ratio (you don't rotate the camera mid-sweep). Two frames whose
 * aspects differ by more than this factor can't be part of the same pano — which cleanly rejects a
 * stitched panorama (wide) sitting next to its portrait source frames.
 */
const MAX_ASPECT_RATIO = 1.3;

export interface PanoCluster {
  memberIds: string[];
  orientation: PanoOrientation;
}

export interface PanoOptions {
  /** Max gap between consecutive frames to still count as one pan. */
  windowMs: number;
  /** Min whole-frame Hamming between consecutive frames, so same-scene near-duplicates aren't panos. */
  minWholeHamming: number;
  /**
   * Max seam score (mean absolute luma difference, 0–255, at the best-aligned overlap) for two frames
   * to count as continuing into each other. Lower = stricter; a real seam scores far below random.
   */
  maxSeamScore: number;
  /** Overlap must be at least this fraction of a frame (rejects trivial slivers). */
  minOverlap: number;
  /** …and at most this fraction (a near-full overlap is the same scene, not a pan). */
  maxOverlap: number;
  /** Minimum frames for a run to qualify as a pano (≥ 2). */
  minSize: number;
}

/** The best alignment found between two frames on one axis. */
export interface SeamMatch {
  score: number; // mean abs luma diff at the best overlap (0 = identical, ~big = unrelated)
  overlap: number; // overlap as a fraction of the frame [0, 1]
  forward: boolean; // true: a's trailing edge meets b's leading edge (pan right / down)
}

/**
 * Groups `assets` into panoramas. `signatures` maps assetId → its grayscale signature and `hashes` →
 * its whole-frame hash. A pair must be (a) close in time + same camera, (b) distinct overall
 * (`minWholeHamming` apart, so same-scene shots are rejected), and (c) actually overlap on one axis —
 * found by sliding, scored under `maxSeamScore`. The run adopts the lower-scoring axis of its first
 * overlapping pair and keeps it. Assets without a `taken` time or a signature break the run.
 */
export function clusterPanos(
  assets: readonly PanoAsset[],
  signatures: ReadonlyMap<string, Uint8Array>,
  hashes: ReadonlyMap<string, string>,
  opts: PanoOptions,
): PanoCluster[] {
  const ordered = assets
    .filter((a) => a.taken && !Number.isNaN(Date.parse(a.taken)))
    .sort((a, b) => Date.parse(a.taken) - Date.parse(b.taken));

  const clusters: PanoCluster[] = [];
  // First split into maximal time+camera-adjacent runs, then resolve each run's panos. Splitting on
  // time alone (cheap) keeps the expensive overlap matching to runs that could actually be a sweep.
  let i = 0;
  while (i < ordered.length) {
    let j = i;
    while (j + 1 < ordered.length && timeAdjacent(ordered[j], ordered[j + 1], opts)) j++;
    if (j - i + 1 >= opts.minSize)
      emitPanos(ordered.slice(i, j + 1), signatures, hashes, opts, clusters);
    i = j + 1;
  }
  return clusters;
}

function timeAdjacent(a: PanoAsset, b: PanoAsset, opts: PanoOptions): boolean {
  const closeInTime = Date.parse(b.taken) - Date.parse(a.taken) <= opts.windowMs;
  return closeInTime && (a.camera ?? '') === (b.camera ?? '');
}

/** One adjacent pair's match on each axis, and whether it's eligible at all (has signatures, distinct). */
interface PairMatch {
  h: SeamMatch;
  v: SeamMatch;
  eligible: boolean;
}

const NO_MATCH: SeamMatch = { score: Infinity, overlap: 0, forward: true };

function pairMatch(
  prev: PanoAsset,
  next: PanoAsset,
  signatures: ReadonlyMap<string, Uint8Array>,
  hashes: ReadonlyMap<string, string>,
  opts: PanoOptions,
): PairMatch {
  const sa = signatures.get(prev.id);
  const sb = signatures.get(next.id);
  if (sa === undefined || sb === undefined) return { h: NO_MATCH, v: NO_MATCH, eligible: false };
  const wa = hashes.get(prev.id);
  const wb = hashes.get(next.id);
  // Same scene (near-identical whole frames) → not a pan.
  const distinct =
    wa === undefined || wb === undefined || hammingDistance(wa, wb) >= opts.minWholeHamming;
  return {
    h: overlapMatch(sa, sb, 'horizontal', opts),
    v: overlapMatch(sa, sb, 'vertical', opts),
    eligible: distinct && aspectCompatible(prev, next),
  };
}

/** True unless both frames declare an aspect ratio and they differ by more than {@link MAX_ASPECT_RATIO}. */
function aspectCompatible(a: PanoAsset, b: PanoAsset): boolean {
  if (!a.aspect || !b.aspect) return true; // unknown aspect → don't gate
  const ratio = a.aspect > b.aspect ? a.aspect / b.aspect : b.aspect / a.aspect;
  return ratio <= MAX_ASPECT_RATIO;
}

/**
 * Resolves the panos in one time-adjacent run. The whole run's orientation is decided *once*, by its
 * single best-scoring seam — a real pan's strongest overlap lands on the true axis, whereas the
 * perpendicular axis only ever matches coincidentally (e.g. frames that share a sky/horizon layout).
 * Then it walks the run on that axis, splitting where a seam fails, and emits sub-runs ≥ `minSize`.
 */
function emitPanos(
  run: readonly PanoAsset[],
  signatures: ReadonlyMap<string, Uint8Array>,
  hashes: ReadonlyMap<string, string>,
  opts: PanoOptions,
  out: PanoCluster[],
): void {
  const pairs = run
    .slice(0, -1)
    .map((prev, k) => pairMatch(prev, run[k + 1], signatures, hashes, opts));
  const orientation = runOrientation(pairs, opts);
  if (!orientation) return;

  // Walk the run on the chosen axis; a broken (or past-the-end) seam closes the current sub-run.
  let start = 0;
  for (let k = 0; k <= pairs.length; k++) {
    if (connected(pairs[k], orientation, opts)) continue;
    if (k - start + 1 >= opts.minSize) {
      out.push({ memberIds: run.slice(start, k + 1).map((a) => a.id), orientation });
    }
    start = k + 1;
  }
}

/** The axis of the run's single best seam, or null if no pair overlaps closely enough to be a pan. */
function runOrientation(pairs: readonly PairMatch[], opts: PanoOptions): PanoOrientation | null {
  let bestH = Infinity;
  let bestV = Infinity;
  for (const p of pairs) {
    if (!p.eligible) continue;
    bestH = Math.min(bestH, p.h.score);
    bestV = Math.min(bestV, p.v.score);
  }
  if (Math.min(bestH, bestV) > opts.maxSeamScore) return null;
  return bestH <= bestV ? 'horizontal' : 'vertical';
}

/** Whether a pair continues the pan on `orientation` (eligible + scores within threshold). */
function connected(
  pair: PairMatch | undefined,
  orientation: PanoOrientation,
  opts: PanoOptions,
): boolean {
  if (!pair?.eligible) return false;
  const score = (orientation === 'horizontal' ? pair.h : pair.v).score;
  return score <= opts.maxSeamScore;
}

/**
 * Takes a fixed-width template from `a`'s edge and slides it across `b` to find where they continue
 * into each other. Forward (pan right/down): `a`'s *trailing* band is the template, slid from `b`'s
 * leading edge inward — the gap it travels is the overlap. Backward (pan left/up): `a`'s *leading*
 * band slid in from `b`'s trailing edge. Returns the best (lowest mean-abs-difference) alignment;
 * lines are mean-subtracted so exposure/vignette differences don't swamp the structural match.
 */
export function overlapMatch(
  a: Uint8Array,
  b: Uint8Array,
  axis: PanoOrientation,
  opts: PanoOptions,
): SeamMatch {
  const n = SIGNATURE_SIZE;
  const band = Math.max(1, Math.round(BAND_FRACTION * n));
  const linesA = meanSubtractedLines(a, n, axis);
  const linesB = meanSubtractedLines(b, n, axis);
  // Overlap = (band + gap) / n, where `gap` is how far b's window sits from b's leading edge. Clamp
  // the gap so the overlap stays within [minOverlap, maxOverlap] and the window fits inside the frame.
  const gapMin = Math.max(0, Math.round(opts.minOverlap * n) - band);
  const gapMax = Math.min(n - band, Math.round(opts.maxOverlap * n) - band);

  let best: SeamMatch = { score: Infinity, overlap: 0, forward: true };
  for (let gap = gapMin; gap <= gapMax; gap++) {
    const overlap = (band + gap) / n;
    const forward = bandDiff(linesA, n - band, linesB, gap, band, n);
    if (forward < best.score) best = { score: forward, overlap, forward: true };
    const backward = bandDiff(linesA, 0, linesB, n - band - gap, band, n);
    if (backward < best.score) best = { score: backward, overlap, forward: false };
  }
  return best;
}

/**
 * Splits a signature grid into `n` lines perpendicular to the pan axis (columns for horizontal, rows
 * for vertical), each mean-subtracted so only structure — not absolute brightness — is compared.
 */
function meanSubtractedLines(grid: Uint8Array, n: number, axis: PanoOrientation): Float64Array[] {
  const lines: Float64Array[] = [];
  for (let k = 0; k < n; k++) {
    const line = new Float64Array(n);
    let sum = 0;
    for (let j = 0; j < n; j++) {
      const value = axis === 'horizontal' ? grid[j * n + k] : grid[k * n + j];
      line[j] = value;
      sum += value;
    }
    const mean = sum / n;
    for (let j = 0; j < n; j++) line[j] -= mean;
    lines.push(line);
  }
  return lines;
}

/** Mean absolute difference between a `band`-wide run of A lines (from `aStart`) and B (from `bStart`). */
function bandDiff(
  linesA: readonly Float64Array[],
  aStart: number,
  linesB: readonly Float64Array[],
  bStart: number,
  band: number,
  n: number,
): number {
  let sum = 0;
  for (let i = 0; i < band; i++) {
    const la = linesA[aStart + i];
    const lb = linesB[bStart + i];
    for (let j = 0; j < n; j++) sum += Math.abs(la[j] - lb[j]);
  }
  return sum / (band * n);
}
