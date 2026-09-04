// Pairing the eyes of a split stereo shoot: one album holds every left eye, another every right.
//
// Unlike in-album stereo (`clusterStereo`), there is nothing to cluster — an all-left album holds no
// near-identical frames at all, because every frame in it is a different scene. The two eyes of one
// shot live in *different* albums, so this is a bipartite match: left frame → right frame.
//
// **The match is carried by the pictures, not by the clocks.** Two eyes of one shot are two
// near-identical photographs, and that is the only thing about them guaranteed to be true. Nothing
// else is: the two bodies need not be synchronised, one may have been powered off and come back with
// a clock hours out, and the filenames are two independent counters. So a capture time is used only
// to break a tie between two equally good visual matches, and never to admit or reject one.
//
// It was the other way round first — a voted clock offset, then nearest-in-time within a second of it
// — and it failed exactly where it was needed. Pairs the eye could see at a glance went unmatched
// because the bodies disagreed about what time it was.
//
// Pure over cached signatures + metadata — no pixels, no network.

import { FrameSignature } from './detection-types';
import { MATCH_SIZE, alignedSignatureDistance, reduceSignature } from './phash';

/** The minimum a frame must expose to be paired. */
export interface EyeFrame {
  id: string;
  /** ISO 8601 capture time. Only ever a tie-break — a frame with none still pairs on its picture. */
  taken: string;
}

/** One shot, recovered: the left album's frame and the right album's frame of the same moment. */
export interface EyePair {
  leftId: string;
  rightId: string;
}

/**
 * The first pass's grid and slide. A coarse version of the real measurement rather than a different
 * one — that distinction is the whole point of it (see {@link pairEyes}).
 */
export const COARSE_SIZE = 8;
export const COARSE_SHIFT = 2;

export interface EyePairOptions {
  /**
   * First pass: the widest coarse aligned distance still worth measuring properly. Deliberately
   * generous — its job is to throw out plainly different scenes cheaply, not to decide anything.
   */
  prefilterDistance: number;
  /** The decision: max {@link alignedSignatureDistance} for two frames to be one shot. */
  maxDistance: number;
  /** How far one frame may slide sideways, in reduced-signature columns. */
  maxShift: number;
}

/**
 * Provisional, like the other detector thresholds, but measured rather than guessed. On two real
 * split shoots — hand-held, two people standing well apart — the aligned distance came out at 6.2
 * and 15.9 for true pairs, against 34.3 for another moment of the same scene and 52.5 for a
 * different scene. 25 sits in that gap.
 *
 * The pre-filter is set more than twice the worst true pair measured on the coarse grid (13.4), and
 * still below the nearest wrong answer there (24.4). It is meant to be embarrassingly generous: it
 * exists to save arithmetic, and a pair it throws out is a pair nothing downstream can recover.
 */
export const DEFAULT_EYE_PAIR_OPTIONS: EyePairOptions = {
  prefilterDistance: 30,
  maxDistance: 25,
  maxShift: 6,
};

/** Width of the histogram bins the offset is voted for in. */
const BUCKET_MS = 1000;

interface TimedFrame {
  id: string;
  ms: number;
}

/**
 * The rig's clock offset in ms (right clock minus left clock), or null when the two albums show no
 * agreement at all — which is an ordinary answer here, not a failure. Two bodies need not be
 * synchronised, and one powered off and back on can return with its clock hours out. Nothing depends
 * on this: it only breaks ties between equally good visual matches.
 *
 * Voted for rather than averaged. Every left frame is compared against every right frame, and the
 * gaps are dropped into one-second bins: the true offset makes a spike, because every genuine pair
 * shares it, while gaps between unrelated frames scatter across the whole shoot. A mean would be
 * dragged by that scatter and a nearest-neighbour guess would collapse the moment the offset grew
 * past the gap between two shots — which is exactly the case this exists for.
 *
 * The winning bin needs real support (a fifth of the smaller album, at least two frames) so that two
 * albums with nothing to do with each other pair nothing rather than pairing noise.
 */
export function estimateClockOffset(
  left: readonly EyeFrame[],
  right: readonly EyeFrame[],
): number | null {
  const l = timed(left);
  const r = timed(right);
  if (l.length === 0 || r.length === 0) return null;

  const votes = new Map<number, number[]>();
  for (const a of l) {
    for (const b of r) {
      const gap = b.ms - a.ms;
      const bin = Math.round(gap / BUCKET_MS);
      votes.set(bin, [...(votes.get(bin) ?? []), gap]);
    }
  }

  const [best] = [...votes.values()].sort((x, y) => y.length - x.length);
  const needed = Math.max(2, Math.ceil(0.2 * Math.min(l.length, r.length)));
  if (!best || best.length < needed) return null;
  return median(best);
}

/**
 * Pairs each left frame with the right frame that is the same photograph, at most one apiece.
 *
 * Two passes, because the decisive comparison is too expensive to run on every combination — but
 * both passes are the *same* measurement, one coarse and one careful: the two frames' signatures slid
 * over one another to find how alike they are once the difference in framing is taken out (see
 * {@link alignedSignatureDistance}). The first pass runs on an 8×8 grid to throw out plainly
 * different scenes cheaply; what survives is measured on 32×32.
 *
 * A *hash* used to be the first pass, and that was the same mistake one level down. A hash distance
 * is mostly framing, so a generous threshold on it still threw out real pairs — and threw them out
 * silently, before anything could measure them properly. A cheap version of the right measurement
 * can be made as generous as you like; a cheap version of the wrong one cannot be made safe. The closest is claimed first, so the
 * strongest matches settle before weaker ones can steal a partner.
 *
 * It was the hash alone that decided, once, and it was measuring the wrong thing: most of the
 * distance between two eyes of one shot is *where the photographers stood*, not what they
 * photographed. Widening the tolerance to admit those pairs would have admitted every near-miss with
 * them; taking the framing out of the measurement instead separates the two by a wide margin.
 *
 * A frame with no cached signature is not a candidate at all — it has not been scanned yet, and
 * guessing from the clock is how the wrong two photographs used to end up side by side as a "pair".
 *
 * Capture time enters only as a tie-break, and only when the two albums happen to agree on a clock
 * offset well enough to vote one (see {@link estimateClockOffset}). Two right frames equally close
 * in appearance — the same scene shot twice — are then separated by which was taken at the moment
 * the left one was. When the clocks say nothing, the tie is left to input order.
 *
 * A frame left over stays unpaired on purpose. Selection decides what that means: an incomplete pair
 * once both albums are scanned out, and nothing at all before then.
 *
 * Returns pairs in the left album's own order.
 */
export function pairEyes(
  left: readonly EyeFrame[],
  right: readonly EyeFrame[],
  signatures: ReadonlyMap<string, FrameSignature>,
  opts: EyePairOptions = DEFAULT_EYE_PAIR_OPTIONS,
): EyePair[] {
  const offset = estimateClockOffset(left, right);
  const candidates = scoreCandidates(left, right, signatures, offset, opts);
  candidates.sort((x, y) => x.distance - y.distance || x.drift - y.drift);

  const takenLeft = new Set<string>();
  const takenRight = new Set<string>();
  const pairs: EyePair[] = [];
  for (const candidate of candidates) {
    if (takenLeft.has(candidate.leftId) || takenRight.has(candidate.rightId)) continue;
    takenLeft.add(candidate.leftId);
    takenRight.add(candidate.rightId);
    pairs.push({ leftId: candidate.leftId, rightId: candidate.rightId });
  }

  const order = new Map(left.map((frame, i) => [frame.id, i]));
  return pairs.sort((a, b) => (order.get(a.leftId) ?? 0) - (order.get(b.leftId) ?? 0));
}

/**
 * Every combination worth offering the greedy claim, scored. Coarse first, and only what survives
 * that is measured on the fine grid — the two passes being the same measurement at two costs.
 */
function scoreCandidates(
  left: readonly EyeFrame[],
  right: readonly EyeFrame[],
  signatures: ReadonlyMap<string, FrameSignature>,
  offset: number | null,
  opts: EyePairOptions,
): Candidate[] {
  const frames = [...left, ...right];
  const coarse = reduceAll(frames, signatures, COARSE_SIZE);
  const fine = reduceAll(frames, signatures, MATCH_SIZE);

  const candidates: Candidate[] = [];
  for (const a of left) {
    const coarseFrom = coarse.get(a.id);
    const from = fine.get(a.id);
    if (!coarseFrom || !from) continue;
    for (const b of right) {
      const distance = score(b.id, { coarse, fine, coarseFrom, from }, opts);
      if (distance === null) continue;
      candidates.push({ leftId: a.id, rightId: b.id, distance, drift: driftOf(a, b, offset) });
    }
  }
  return candidates;
}

/** One combination's fine distance, or null when either pass refuses it. */
function score(
  rightId: string,
  reduced: {
    coarse: ReadonlyMap<string, Uint8Array>;
    fine: ReadonlyMap<string, Uint8Array>;
    coarseFrom: Uint8Array;
    from: Uint8Array;
  },
  opts: EyePairOptions,
): number | null {
  const coarseTo = reduced.coarse.get(rightId);
  const to = reduced.fine.get(rightId);
  if (!coarseTo || !to) return null;
  const rough = alignedSignatureDistance(reduced.coarseFrom, coarseTo, COARSE_SIZE, COARSE_SHIFT);
  if (rough > opts.prefilterDistance) return null;
  const distance = alignedSignatureDistance(reduced.from, to, MATCH_SIZE, opts.maxShift);
  return distance > opts.maxDistance ? null : distance;
}

/** Every frame's signature reduced once, rather than per comparison — this runs n×m times. */
function reduceAll(
  frames: readonly EyeFrame[],
  signatures: ReadonlyMap<string, FrameSignature>,
  size: number,
): Map<string, Uint8Array> {
  const reduced = new Map<string, Uint8Array>();
  for (const frame of frames) {
    const signature = signatures.get(frame.id);
    if (signature) reduced.set(frame.id, reduceSignature(signature, size));
  }
  return reduced;
}

/** One possible pair, ranked by how alike the frames look and then by how well the clocks agree. */
interface Candidate {
  leftId: string;
  rightId: string;
  distance: number;
  drift: number;
}

/**
 * How far this pair's capture gap sits from the rig's measured offset, in ms — the tie-break.
 *
 * `UNTIMED` when there is no offset to measure against or either frame has no readable time, so that
 * two such candidates tie with each other instead of being ordered by an accident of arithmetic.
 */
const UNTIMED = Number.MAX_SAFE_INTEGER;

function driftOf(a: EyeFrame, b: EyeFrame, offset: number | null): number {
  if (offset === null) return UNTIMED;
  const from = Date.parse(a.taken);
  const to = Date.parse(b.taken);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return UNTIMED;
  return Math.abs(to - from - offset);
}

/** Frames with a readable capture time, as epoch ms — the rest cannot be placed against a clock. */
function timed(frames: readonly EyeFrame[]): TimedFrame[] {
  return frames
    .map((frame) => ({ id: frame.id, ms: Date.parse(frame.taken) }))
    .filter((frame) => Number.isFinite(frame.ms));
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}
