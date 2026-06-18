// Pure analysis backing the developer detection lab: runs burst clustering and, for each cluster,
// pulls the immediately-adjacent (excluded) frames so the lab can show *why* a burst starts/stops
// where it does. No IO — the component feeds it loaded assets + hashes and re-runs it as sliders move.

import { BurstOptions, DetectAsset, clusterBursts } from './burst';
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
