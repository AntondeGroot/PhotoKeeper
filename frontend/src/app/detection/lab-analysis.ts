// Pure analysis backing the developer detection lab: runs burst (and pano) clustering and, for each
// cluster, pulls the immediately-adjacent (excluded) frames so the lab can show *why* a group
// starts/stops where it does. No IO — the component feeds it loaded assets + hashes and re-runs it as
// sliders move.

import { BurstOptions, DetectAsset, clusterBursts } from './burst';
import { PanoAsset, PanoOptions, clusterPanos, overlapMatch } from './pano';
import { FrameSignature, PanoOrientation } from './detection-types';
import { hammingDistance } from './phash';

/** A frame just outside a cluster, with how far it sits from the cluster edge. */
export interface LabNeighbor {
  id: string;
  gapMs: number; // time gap to the adjacent cluster member
  hamming: number | null; // Hamming distance to that member, or null if either frame isn't hashed
}

/** One detected cluster plus the frames that bracket it (what the thresholds excluded). */
export interface LabCluster {
  memberIds: string[];
  before: LabNeighbor | null;
  after: LabNeighbor | null;
}

export function analyzeClusters(
  assets: readonly DetectAsset[],
  hashes: ReadonlyMap<string, string>,
  opts: BurstOptions,
): LabCluster[] {
  const ordered = [...assets]
    .filter((a) => a.taken && !Number.isNaN(Date.parse(a.taken)))
    .sort((a, b) => Date.parse(a.taken) - Date.parse(b.taken));
  const indexById = new Map(ordered.map((a, i) => [a.id, i]));

  return clusterBursts(ordered, hashes, opts).map((cluster) => {
    const ids = cluster.memberIds;
    const firstIdx = indexById.get(ids[0]) ?? 0;
    const lastIdx = indexById.get(ids[ids.length - 1]) ?? 0;
    return {
      memberIds: ids,
      before: neighbor(ordered[firstIdx - 1], ordered[firstIdx], hashes),
      after: neighbor(ordered[lastIdx + 1], ordered[lastIdx], hashes),
    };
  });
}

function neighbor(
  candidate: DetectAsset | undefined,
  edge: DetectAsset,
  hashes: ReadonlyMap<string, string>,
): LabNeighbor | null {
  if (!candidate) return null;
  const hc = hashes.get(candidate.id);
  const he = hashes.get(edge.id);
  return {
    id: candidate.id,
    gapMs: Math.abs(Date.parse(candidate.taken) - Date.parse(edge.taken)),
    hamming: hc !== undefined && he !== undefined ? hammingDistance(hc, he) : null,
  };
}

/** A frame just outside a pano, with its best seam score + whole-frame distance to the cluster edge. */
export interface LabPanoNeighbor {
  id: string;
  gapMs: number;
  seamScore: number | null; // best slide-match score on the cluster's axis, null if no signature
  wholeHamming: number | null; // whole-frame distance — shows whether it's distinct enough to be a pan
}

/** One detected pano plus its pan axis and the frames that bracket it. */
export interface LabPanoCluster {
  memberIds: string[];
  orientation: PanoOrientation;
  before: LabPanoNeighbor | null;
  after: LabPanoNeighbor | null;
}

export function analyzePanoClusters(
  assets: readonly PanoAsset[],
  signatures: ReadonlyMap<string, FrameSignature>,
  hashes: ReadonlyMap<string, string>,
  opts: PanoOptions,
): LabPanoCluster[] {
  const ordered = [...assets]
    .filter((a) => a.taken && !Number.isNaN(Date.parse(a.taken)))
    .sort((a, b) => Date.parse(a.taken) - Date.parse(b.taken));
  const indexById = new Map(ordered.map((a, i) => [a.id, i]));

  return clusterPanos(ordered, signatures, hashes, opts).map((cluster) => {
    const ids = cluster.memberIds;
    const firstIdx = indexById.get(ids[0]) ?? 0;
    const lastIdx = indexById.get(ids[ids.length - 1]) ?? 0;
    const o = cluster.orientation;
    return {
      memberIds: ids,
      orientation: o,
      before: panoNeighbor(ordered[firstIdx - 1], ordered[firstIdx], signatures, hashes, o, opts),
      after: panoNeighbor(ordered[lastIdx + 1], ordered[lastIdx], signatures, hashes, o, opts),
    };
  });
}

function panoNeighbor(
  candidate: PanoAsset | undefined,
  edge: PanoAsset,
  signatures: ReadonlyMap<string, FrameSignature>,
  hashes: ReadonlyMap<string, string>,
  orientation: PanoOrientation,
  opts: PanoOptions,
): LabPanoNeighbor | null {
  if (!candidate) return null;
  const sc = signatures.get(candidate.id);
  const se = signatures.get(edge.id);
  const hc = hashes.get(candidate.id);
  const he = hashes.get(edge.id);
  return {
    id: candidate.id,
    gapMs: Math.abs(Date.parse(candidate.taken) - Date.parse(edge.taken)),
    seamScore: se && sc ? Math.round(overlapMatch(se, sc, orientation, opts).score) : null,
    wholeHamming: hc !== undefined && he !== undefined ? hammingDistance(he, hc) : null,
  };
}
