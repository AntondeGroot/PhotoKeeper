// The split-shoot panel's report: why each frame of a left-eye album did or did not find its other
// eye in the paired right-eye album.
//
// Exists because the two failure modes look identical from the review deck — both say "missing eye"
// — and are fixed in opposite ways. Either the frame was never hashed (the scan has not reached it,
// or is not hashing that album at all) and the matcher had nothing to compare, or it was hashed and
// its best candidate simply sits too far away. So every unpaired frame reports which of those it is,
// and when a candidate exists, which frame it was and how far off. A tolerance that needs moving
// looks entirely different from a scan that never ran — and the rejected candidate is worth *seeing*,
// because only the picture says whether refusing it was right.
//
// Pure over metadata + cached signatures, like the detector it reports on.

import { FrameSignature } from '../../detectors/detection-types';
import { MATCH_SIZE, alignedSignatureDistance, reduceSignature } from '../../detectors/phash';
import {
  COARSE_SHIFT,
  COARSE_SIZE,
  DEFAULT_EYE_PAIR_OPTIONS,
  EyeFrame,
  pairEyes,
} from '../../detectors/stereo-pairs';

/** A frame as the report names it: the id the stores key on, plus something human to read. */
export interface SplitShootFrame extends EyeFrame {
  name: string;
}

export interface SplitShootInput {
  left: readonly SplitShootFrame[];
  right: readonly SplitShootFrame[];
  /** What actually decides a pair — the hash is only the matcher's cheap first pass. */
  signatures: ReadonlyMap<string, FrameSignature>;
  tolerance: number;
}

/**
 * What became of one left frame.
 *
 * - `paired` — it found its other eye.
 * - `notHashed` — no cached signature, so the matcher never had a picture of it to compare.
 * - `noCandidates` — nothing in the right album is hashed either.
 * - `rejected` — hashed, candidates existed, and the closest was still refused.
 */
export type PairOutcome = 'paired' | 'notHashed' | 'noCandidates' | 'rejected';

export interface SplitShootRow {
  outcome: PairOutcome;
  left: SplitShootFrame;
  /** The frame it paired with, or — when it did not — the closest one that was refused. */
  other: SplitShootFrame | null;
  distance: number | null;
  /**
   * When `other` went to a different left frame: which one, and how well it scored.
   *
   * Without this a low distance and a refusal read as a contradiction — the panel says two frames
   * are alike and then refuses them, and the reason is a third frame you cannot see. The winner is
   * named and shown, so the comparison the matcher actually made is the comparison on screen.
   */
  claimedBy: { frame: SplitShootFrame; distance: number } | null;
  /** Why `other` was refused, in the user's terms. Empty for a pair. */
  note: string;
}

export interface SplitShootReport {
  summary: string[];
  rows: SplitShootRow[];
  unpairedRight: SplitShootFrame[];
}

export function buildSplitShootReport(input: SplitShootInput): SplitShootReport {
  const pairs = pairEyes(input.left, input.right, input.signatures, {
    ...DEFAULT_EYE_PAIR_OPTIONS,
    maxDistance: input.tolerance,
  });
  const partnerOf = new Map(pairs.map((pair) => [pair.leftId, pair.rightId]));
  const rightById = new Map(input.right.map((frame) => [frame.id, frame]));
  // Which left frame took each right one — the answer to "then who did it pair with?".
  const leftById = new Map(input.left.map((frame) => [frame.id, frame]));
  const claimantOf = new Map(
    pairs.flatMap((pair) => {
      const winner = leftById.get(pair.leftId);
      return winner ? ([[pair.rightId, winner]] as [string, SplitShootFrame][]) : [];
    }),
  );

  const rows = input.left.map((frame) =>
    describeLeft(frame, { partnerOf, rightById, claimantOf }, input),
  );
  const claimed = new Set(pairs.map((pair) => pair.rightId));
  const unpairedRight = input.right.filter((frame) => !claimed.has(frame.id));

  return {
    summary: [
      `${input.left.length} left · ${input.right.length} right · tolerance ${input.tolerance}`,
      `paired ${pairs.length}, unpaired left ${input.left.length - pairs.length}, ` +
        `unpaired right ${unpairedRight.length}`,
      `scanned: left ${countHashed(input.left, input.signatures)}/${input.left.length}, ` +
        `right ${countHashed(input.right, input.signatures)}/${input.right.length}`,
    ],
    rows,
    unpairedRight,
  };
}

/** What the report needs to look up while explaining one frame. */
interface Lookups {
  partnerOf: ReadonlyMap<string, string>;
  rightById: ReadonlyMap<string, SplitShootFrame>;
  claimantOf: ReadonlyMap<string, SplitShootFrame>;
}

/** One left frame's outcome: its partner, or the closest frame that was refused and why. */
function describeLeft(
  left: SplitShootFrame,
  lookups: Lookups,
  input: SplitShootInput,
): SplitShootRow {
  const partnerId = lookups.partnerOf.get(left.id);
  if (partnerId) {
    return {
      outcome: 'paired',
      left,
      other: lookups.rightById.get(partnerId) ?? null,
      distance: distanceBetween(left.id, partnerId, input),
      claimedBy: null,
      note: '',
    };
  }
  if (!input.signatures.has(left.id)) {
    return {
      outcome: 'notHashed',
      left,
      other: null,
      distance: null,
      claimedBy: null,
      note: 'not scanned — the matcher never had a picture of this frame',
    };
  }
  const nearest = nearestRight(left.id, input);
  if (!nearest) {
    return {
      outcome: 'noCandidates',
      left,
      other: null,
      distance: null,
      claimedBy: null,
      note: 'no scanned frame in the right album to compare against',
    };
  }
  return {
    outcome: 'rejected',
    left,
    other: nearest.frame,
    distance: nearest.distance,
    ...refusal(left, nearest, lookups, input),
  };
}

/**
 * Why the closest frame was refused: either nothing was near enough, or something else was nearer.
 *
 * The second reason is the one that reads as a contradiction without a name attached — a small
 * distance, and a refusal. Naming the winner and its score turns it back into a comparison.
 */
function refusal(
  left: SplitShootFrame,
  nearest: { frame: SplitShootFrame; distance: number },
  lookups: Lookups,
  input: SplitShootInput,
): Pick<SplitShootRow, 'claimedBy' | 'note'> {
  const winner = lookups.claimantOf.get(nearest.frame.id);
  const claimedBy =
    winner && winner.id !== left.id
      ? { frame: winner, distance: distanceBetween(winner.id, nearest.frame.id, input) ?? 0 }
      : null;

  if (nearest.distance > input.tolerance) {
    // Nothing was near enough. Whose frame it turned out to be is incidental, but worth saying.
    const taken = claimedBy ? `; that right frame is paired with ${claimedBy.frame.name}` : '';
    return { claimedBy, note: `over tolerance (${nearest.distance} > ${input.tolerance})${taken}` };
  }
  if (claimedBy) {
    // Spelled out in full because the short form ("taken by X") reads as though this frame had been
    // matched with X — another *left* frame — when what happened is that the right frame between
    // them went elsewhere.
    return {
      claimedBy,
      note:
        `within tolerance, but the right frame went to ${claimedBy.frame.name} ` +
        `instead (${claimedBy.distance})`,
    };
  }
  // Within tolerance, unclaimed, and still unpaired: the matcher never scored this combination,
  // because the cheap first pass threw it out before the careful one could look. A pre-filter that
  // can do that to a real pair is a bug in the pre-filter, so the row says which number did it.
  const rough = coarseDistanceBetween(left.id, nearest.frame.id, input);
  return {
    claimedBy: null,
    note:
      `within tolerance, but the pre-filter dropped it first ` +
      `(coarse ${rough} > ${DEFAULT_EYE_PAIR_OPTIONS.prefilterDistance})`,
  };
}

/**
 * The closest right frame to `id` and how far away, ignoring the tolerance and who claimed what.
 *
 * Deliberately the same measurement the matcher decides by — a panel that reported a different
 * number would send you tuning against something the app never consults. It skips the cheap
 * pre-filter, so a frame the pre-filter threw out is still shown with its real distance.
 */
function nearestRight(
  leftId: string,
  input: SplitShootInput,
): { frame: SplitShootFrame; distance: number } | null {
  let best: { frame: SplitShootFrame; distance: number } | null = null;
  for (const frame of input.right) {
    const distance = distanceBetween(leftId, frame.id, input);
    if (distance === null) continue;
    if (!best || distance < best.distance) best = { frame, distance };
  }
  return best;
}

/** The aligned signature distance between two frames, or null when either has not been scanned. */
function distanceBetween(leftId: string, rightId: string, input: SplitShootInput): number | null {
  const a = input.signatures.get(leftId);
  const b = input.signatures.get(rightId);
  if (!a || !b) return null;
  const distance = alignedSignatureDistance(
    reduceSignature(a),
    reduceSignature(b),
    MATCH_SIZE,
    DEFAULT_EYE_PAIR_OPTIONS.maxShift,
  );
  return Math.round(distance * 10) / 10;
}

/** The first pass's score for two frames — what the pre-filter judged them by. */
function coarseDistanceBetween(
  leftId: string,
  rightId: string,
  input: SplitShootInput,
): number | null {
  const a = input.signatures.get(leftId);
  const b = input.signatures.get(rightId);
  if (!a || !b) return null;
  const distance = alignedSignatureDistance(
    reduceSignature(a, COARSE_SIZE),
    reduceSignature(b, COARSE_SIZE),
    COARSE_SIZE,
    COARSE_SHIFT,
  );
  return Math.round(distance * 10) / 10;
}

function countHashed(
  frames: readonly SplitShootFrame[],
  signatures: ReadonlyMap<string, FrameSignature>,
): number {
  return frames.filter((frame) => signatures.has(frame.id)).length;
}
