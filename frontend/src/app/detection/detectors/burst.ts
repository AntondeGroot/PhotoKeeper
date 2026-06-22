// Burst detection: group runs of frames shot in quick succession that look near-identical.
//
// Pure over metadata + cached hashes — no pixels, no network — so it's cheap to re-run and easy to
// test. A burst is a maximal run of assets, ordered by capture time, where each consecutive pair is
// close in time, from the same camera, and within a small Hamming distance of each other.

import { hammingDistance } from './phash';

/** The minimum an asset must expose to be grouped. */
export interface DetectAsset {
  id: string;
  taken: string; // ISO 8601 capture time
  camera?: string; // optional; when absent, the camera check is skipped
}

export interface BurstCluster {
  memberIds: string[];
}

export interface BurstOptions {
  /** Max gap between consecutive frames to still count as one burst. */
  windowMs: number;
  /** Max Hamming distance between consecutive frames to count as near-identical. */
  maxHamming: number;
  /** Minimum frames for a run to qualify as a burst (≥ 2). */
  minSize: number;
}

/**
 * Groups `assets` into bursts. `hashes` maps assetId → perceptual hash; assets without a hash fall
 * back to the time + camera checks alone (so detection degrades gracefully before everything is
 * hashed). Assets without a `taken` time are ignored. Non-burst singles are simply not returned.
 */
export function clusterBursts(
  assets: readonly DetectAsset[],
  hashes: ReadonlyMap<string, string>,
  opts: BurstOptions,
): BurstCluster[] {
  const ordered = assets
    .filter((a) => a.taken && !Number.isNaN(Date.parse(a.taken)))
    .sort((a, b) => Date.parse(a.taken) - Date.parse(b.taken));

  const clusters: BurstCluster[] = [];
  let run: DetectAsset[] = [];

  const flush = (): void => {
    if (run.length >= opts.minSize) {
      clusters.push({ memberIds: run.map((a) => a.id) });
    }
    run = [];
  };

  for (const asset of ordered) {
    if (run.length === 0) {
      run = [asset];
      continue;
    }
    const prev = run[run.length - 1];
    if (belongsTogether(prev, asset, hashes, opts)) {
      run.push(asset);
    } else {
      flush();
      run = [asset];
    }
  }
  flush();
  return clusters;
}

function belongsTogether(
  prev: DetectAsset,
  next: DetectAsset,
  hashes: ReadonlyMap<string, string>,
  opts: BurstOptions,
): boolean {
  const closeInTime = Date.parse(next.taken) - Date.parse(prev.taken) <= opts.windowMs;
  const sameCamera = (prev.camera ?? '') === (next.camera ?? '');
  return closeInTime && sameCamera && nearDuplicate(prev.id, next.id, hashes, opts.maxHamming);
}

function nearDuplicate(
  a: string,
  b: string,
  hashes: ReadonlyMap<string, string>,
  maxHamming: number,
): boolean {
  const ha = hashes.get(a);
  const hb = hashes.get(b);
  if (ha === undefined || hb === undefined) return true; // not yet hashed → don't block grouping
  return hammingDistance(ha, hb) <= maxHamming;
}
