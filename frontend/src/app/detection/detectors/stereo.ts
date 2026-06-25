// Stereo-set detection: group near-identical frames of one scene shot from a few nearby positions.
//
// Unlike bursts/panos, a stereo set is NOT bounded by time. The photographer takes several frames per
// camera position and may pause between them for movement to settle, so capture times spread out — a
// burst-style time window would wrongly split a set. The robust "same scene" signal is near-identical
// perceptual hashes (low Hamming). An optional GPS-proximity guard keeps two look-alike scenes from
// merging: drone stereo positions sit a few metres apart, while a different scene is far away. Pure over
// metadata + cached hashes — no pixels, no network — so it's cheap to re-run and easy to test.
//
// This finds only the *set*. Splitting it into a shared `left[]` plus GPS-distanced `baselines[]` is the
// hydrator's job (Slice 3) — so the output here is a flat member cluster, ordered as the assets came in.

import { lumaHammingDistance } from './phash';

/** The minimum an asset must expose to be grouped into a stereo set. GPS is optional (handheld → absent). */
export interface StereoAsset {
  id: string;
  lat?: number; // decimal degrees; when absent on either frame, the GPS-proximity guard is skipped
  lng?: number;
}

export interface StereoCluster {
  memberIds: string[];
}

export interface StereoOptions {
  /** Max Hamming distance for two frames to count as the same scene (near-identical). */
  maxHamming: number;
  /** Max metres apart two frames can be and still belong to one set (GPS guard; skipped without GPS). */
  maxMeters: number;
  /** Minimum frames for a cluster to qualify as a stereo set (≥ 2). */
  minSize: number;
}

/**
 * Groups `assets` into stereo sets by single-linkage clustering: two frames share a set when they are
 * both near-identical (`hashes` Hamming ≤ `maxHamming`) and geographically close (≤ `maxMeters`). Either
 * check degrades gracefully — a frame with no cached hash never blocks grouping, and a pair missing GPS
 * on either side skips the distance guard (the handheld fall-back, phash-only). `hashes` maps assetId →
 * perceptual hash. Clusters below `minSize` are dropped. Member ids keep their input order.
 *
 * O(n²) over the album's frames — bounded in practice by the hashed prefix the scan feeds in.
 */
export function clusterStereo(
  assets: readonly StereoAsset[],
  hashes: ReadonlyMap<string, string>,
  opts: StereoOptions,
): StereoCluster[] {
  const n = assets.length;
  const parent = assets.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]; // path halving
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb); // keep the lower index as root
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (sameSet(assets[i], assets[j], hashes, opts)) union(i, j);
    }
  }

  // Gather components, keyed by their (lowest) root so both clusters and their members stay in input order.
  const byRoot = new Map<number, string[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const members = byRoot.get(root) ?? [];
    members.push(assets[i].id);
    byRoot.set(root, members);
  }
  return [...byRoot.values()]
    .filter((ids) => ids.length >= opts.minSize)
    .map((memberIds) => ({ memberIds }));
}

/** Two frames belong to the same set when they look near-identical AND sit close together (when GPS is known). */
function sameSet(
  a: StereoAsset,
  b: StereoAsset,
  hashes: ReadonlyMap<string, string>,
  opts: StereoOptions,
): boolean {
  return nearDuplicate(a.id, b.id, hashes, opts.maxHamming) && gpsClose(a, b, opts.maxMeters);
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
  // Luma only: two camera bodies can render colour differently, which must not split a stereo pair.
  return lumaHammingDistance(ha, hb) <= maxHamming;
}

/** True when both frames lack GPS (guard skipped) or their separation is within `maxMeters`. */
function gpsClose(a: StereoAsset, b: StereoAsset, maxMeters: number): boolean {
  if (a.lat === undefined || a.lng === undefined || b.lat === undefined || b.lng === undefined) {
    return true; // no GPS on one side → fall back to the phash-only signal
  }
  return haversineMeters(a.lat, a.lng, b.lat, b.lng) <= maxMeters;
}

const EARTH_RADIUS_M = 6_371_000;

/**
 * Great-circle distance between two WGS-84 points, in metres. Exported because Slice 3's hydrator reuses
 * it to label each baseline by its displacement from the reference position.
 */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}
