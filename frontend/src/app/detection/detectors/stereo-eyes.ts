// Which eye each frame of a both-eyes stereo album is, so the album can be paired the way a split
// shoot is: left frame → right frame, by how alike the two pictures are (see `pairEyes`).
//
// Two signals, strongest first:
//
// 1. **The file name.** `IMG_0412_L.jpg` says outright which eye it is, and nothing else does —
//    serials only say which *body*, and which body was on the left is a guess.
// 2. **The camera body.** A twin rig writes two serials into one album. Which of them is the left
//    eye is learned from any frame the file name already placed; failing that the two bodies are
//    simply two sides, which is all pairing needs — the card decides which to call left.
//
// A frame neither signal places (one body, no suffix: a drone or a cha-cha shoot) is `unsided`, and
// stays with the in-album clusterers, which handle exactly that case.
//
// Pure over names, serials and cached signatures — no pixels, no network.

import { FrameSignature } from './detection-types';
import { EyePairOptions, pairEyes } from './stereo-pairs';

/** The minimum a frame must expose to be given a side. */
export interface EyeCandidate {
  id: string;
  /** File name, with or without extension. */
  fileName: string;
  /** Camera body serial, when the EXIF carries one. */
  serial?: string;
  /** ISO 8601 capture time — only ever the matcher's tie-break. */
  taken: string;
}

export type Eye = 'left' | 'right';

export interface EyeSplit {
  left: string[];
  right: string[];
  unsided: string[];
}

/** `_L` / `-R` (any case) at the end of the base name, before the extension. */
const EYE_SUFFIX = /[_-]([LR])$/i;

/** What pairing a both-eyes album found: one `[left, right]` per shot, and the frames left to cluster. */
export interface BothEyesPairing {
  pairs: [string, string][];
  unsided: string[];
}

/**
 * Pairs the eyes of an album that holds both: each frame is given a side, and the sided frames are
 * matched one-to-one by picture (`pairEyes`), exactly as a split shoot's two albums are.
 *
 * This replaced single-linkage hash clustering for every frame that has a side. A hash distance is
 * mostly framing, so its threshold sat on top of the gap between a true pair and another moment of
 * the same scene — and single linkage chains: A near B near C made one "stereo set" of A and C,
 * which then showed one photograph on the left and a different one on the right. A one-to-one match
 * on the aligned signature can do neither.
 */
export function pairBothEyes(
  frames: readonly EyeCandidate[],
  signatures: ReadonlyMap<string, FrameSignature>,
  opts?: EyePairOptions,
): BothEyesPairing {
  const split = splitEyes(frames);
  const byId = new Map(frames.map((frame) => [frame.id, frame]));
  const side = (ids: string[]): EyeCandidate[] => ids.map((id) => byId.get(id)!);
  const pairs = pairEyes(side(split.left), side(split.right), signatures, opts);
  return {
    pairs: pairs.map((pair): [string, string] => [pair.leftId, pair.rightId]),
    unsided: split.unsided,
  };
}

/** The eye a file name declares, or null when it declares none. */
export function eyeFromFileName(fileName: string): Eye | null {
  const dot = fileName.lastIndexOf('.');
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  const match = EYE_SUFFIX.exec(base);
  if (!match) return null;
  return match[1].toUpperCase() === 'L' ? 'left' : 'right';
}

/**
 * Sorts an album's frames into the two eyes. Input order is kept within each side, so the
 * matcher's tie-breaks stay deterministic.
 */
export function splitEyes(frames: readonly EyeCandidate[]): EyeSplit {
  const serialSide = sidesBySerial(frames);
  const split: EyeSplit = { left: [], right: [], unsided: [] };
  for (const frame of frames) {
    const eye =
      eyeFromFileName(frame.fileName) ?? (frame.serial ? serialSide.get(frame.serial) : undefined);
    split[eye ?? 'unsided'].push(frame.id);
  }
  return split;
}

/**
 * The left-eye ids of one stereo set, as its file names declare them — or undefined when the names
 * say nothing. One named side is enough: in a pair whose left frame is `_L`, the other frame is the
 * right eye whatever it is called.
 */
export function leftEyeIdsFromFileNames(frames: readonly EyeCandidate[]): Set<string> | undefined {
  const eyes = frames.map((frame) => eyeFromFileName(frame.fileName));
  if (!eyes.includes('left') && !eyes.includes('right')) return undefined;
  // Named left frames are the left eye; failing those, everything not named right is.
  const isLeft = (i: number): boolean =>
    eyes.includes('left') ? eyes[i] === 'left' : eyes[i] !== 'right';
  const left = frames.filter((_, i) => isLeft(i));
  if (left.length === 0 || left.length === frames.length) return undefined;
  return new Set(left.map((frame) => frame.id));
}

/**
 * Which side each body is on — only when the album holds exactly two bodies. The file names vote
 * first; without a vote the lexicographically smaller serial is called left, which pairing does not
 * care about (it is symmetric) and the card overrides with the album's chosen left serial.
 */
function sidesBySerial(frames: readonly EyeCandidate[]): Map<string, Eye> {
  const serials = [...new Set(frames.map((f) => f.serial).filter((s): s is string => !!s))].sort(
    (a, b) => a.localeCompare(b),
  );
  if (serials.length !== 2) return new Map();
  const left = votedLeftSerial(frames, serials) ?? serials[0];
  const right = serials.find((s) => s !== left)!;
  return new Map<string, Eye>([
    [left, 'left'],
    [right, 'right'],
  ]);
}

const EYE_VOTE = { left: 1, right: -1, none: 0 } as const;

/** The serial the named frames put on the left: most `_L` frames, else fewest `_R` frames. */
function votedLeftSerial(frames: readonly EyeCandidate[], serials: string[]): string | undefined {
  const score = (serial: string): number =>
    frames
      .filter((f) => f.serial === serial)
      .reduce((sum, f) => sum + EYE_VOTE[eyeFromFileName(f.fileName) ?? 'none'], 0);
  const [a, b] = serials.map(score);
  if (a === b) return undefined;
  return a > b ? serials[0] : serials[1];
}
