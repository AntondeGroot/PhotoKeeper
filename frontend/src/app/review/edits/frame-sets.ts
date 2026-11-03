import { DetectedGroup } from '../../detection/detectors/detection-types';
import { ReviewItem, unitAssetIds } from '../../photo';

/**
 * Frames sent to be edited as one, most of which Lightroom may merge into one photograph.
 *
 * Lightroom holds them as separate assets, so everything that lists the edit queue starts with one
 * row per frame. These are the rules for folding those rows back into the one piece of work they
 * are, so that finishing a set takes one answer rather than one per frame.
 *
 * A sweep becomes a panorama. Brackets become an HDR, and they arrive as a burst, being near-identical
 * frames seconds apart. Nothing stored can tell brackets from an ordinary burst, but a burst settled
 * in a duel has had its group dissolved, so one still grouped was sent to edit whole.
 *
 * A stereo pair is one shot and so one row, but it stays two photographs: nothing is merged, so there
 * is no file to look for and finishing it sends both eyes to print.
 */

/** The kinds of set that share a row in the edit queue. */
export type FrameSetKind = 'pano' | 'burst' | 'stereo';

/** A set of frames, as the edit queue needs it. */
export interface FrameSet {
  kind: FrameSetKind;
  frameIds: readonly string[];
}

/** Each frame of a set mapped to that set. Every frame of one set shares the same object. */
export function framesByPhoto(groups: readonly DetectedGroup[]): ReadonlyMap<string, FrameSet> {
  const setOf = new Map<string, FrameSet>();
  for (const { type, memberIds } of groups) {
    const set: FrameSet = { kind: type, frameIds: memberIds };
    for (const frameId of memberIds) setOf.set(frameId, set);
  }
  return setOf;
}

/** Items gathered by set, each set where its first item stood; anything else stays alone. */
export function gatherBySet<T>(
  items: readonly T[],
  assetIdOf: (item: T) => string,
  setOf: ReadonlyMap<string, FrameSet>,
): T[][] {
  const bySet = new Map<FrameSet, T[]>();
  const units: T[][] = [];
  for (const item of items) {
    const set = setOf.get(assetIdOf(item));
    const unit = set ? bySet.get(set) : undefined;
    if (unit) {
      unit.push(item);
      continue;
    }
    const started = [item];
    units.push(started);
    if (set) bySet.set(set, started);
  }
  return units;
}

/** The label for a set's row. */
export function setLabel(kind: FrameSetKind, frameCount: number): string {
  const name = { pano: 'Panorama', burst: 'Burst', stereo: 'Stereo' }[kind];
  return `${name} · ${frameCount} ${frameCount === 1 ? 'frame' : 'frames'}`;
}

/** What a set's merged file is called. Only asked of a set that goes looking for one. */
export function mergedName(kind: FrameSetKind): string {
  return kind === 'pano' ? 'panorama' : 'HDR';
}

/** Whether finishing this set starts by looking for a merged file. */
export function looksForMerge(kind: FrameSetKind): boolean {
  return kind !== 'stereo';
}

/** Whether this deck unit is this photograph, or the group card holding it as a frame. */
export function unitHolds(item: ReviewItem, assetId: string): boolean {
  if (item.id === assetId) return true;
  const isCard = item.kind === 'pano' || item.kind === 'burst' || item.kind === 'stereo';
  return isCard && unitAssetIds(item).includes(assetId);
}
