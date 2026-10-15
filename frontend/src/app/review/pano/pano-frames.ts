/**
 * Which photos are offered when someone says a panorama is missing frames.
 *
 * Detection can end a pano early — a frame that overlapped less, a fingerprint that missed — and the
 * result looks complete until you notice the sweep stops short. The fix is not to re-run the
 * detector but to show the shots around the ones it found and let the photographer say which of them
 * belong: they were there, and the answer is obvious to them at a glance.
 *
 * Pure over an album's assets in capture order, so the window can be tested without a store.
 */

/** One photo offered in the picker, in capture order with the pano's own frames marked. */
export interface PanoCandidate {
  id: string;
  name: string;
  ext?: string;
  /** ISO 8601 capture time, '' when unknown — the order this window was built in. */
  taken: string;
  /**
   * True when detection put this photo in a *different* group of its own — most often the other
   * half of this very sweep, split in two. Marked so the strip can show that those frames come as
   * a set, which is the difference between "tap these three" and guessing one at a time.
   */
  inOtherGroup?: boolean;
}

/** An album asset as the picker needs it: enough to identify and order it. */
export interface AlbumAsset {
  id: string;
  name: string;
  ext?: string;
  taken: string;
}

/** How many photos either side of the detected run to offer. */
export const NEIGHBOURS_EACH_SIDE = 6;

/** A pano needs at least this many frames to still be a pano rather than a photo. */
export const MIN_PANO_FRAMES = 2;

/**
 * Sorts an album's assets the way the shutter fired: by capture time, and by name where a camera
 * stamped several frames with the same second — which a pano sweep routinely does.
 */
export function inCaptureOrder(assets: readonly AlbumAsset[]): AlbumAsset[] {
  return [...assets].sort((a, b) => a.taken.localeCompare(b.taken) || a.name.localeCompare(b.name));
}

/**
 * The photos to offer for a pano whose frames are `frameIds`: everything from
 * {@link NEIGHBOURS_EACH_SIDE} before the first frame to that many after the last.
 *
 * The span between the outermost frames is included whole, so a frame detection skipped *inside* the
 * run is offered too — the gap in the middle is exactly as likely as a short end, and it is invisible
 * in the card itself.
 *
 * `otherGroups` are the album's other detected groups, and the window stretches to cover any it
 * reaches into. One sweep detected as two panos is the case this is for: half the frames are already
 * a group, and offering only the six nearest of them would let someone merge *part* of the other
 * half — which is worse than not offering it, because the result looks finished and is not.
 *
 * Returns an empty list when none of the frames are in `assets` (nothing has been scanned, or they
 * belong to another album): with no neighbourhood to place them in, there is nothing to offer.
 */
export function candidateWindow(
  frameIds: readonly string[],
  assets: readonly AlbumAsset[],
  eachSide = NEIGHBOURS_EACH_SIDE,
  otherGroups: readonly (readonly string[])[] = [],
): PanoCandidate[] {
  const ordered = inCaptureOrder(assets);
  const members = new Set(frameIds);
  const positions = ordered.flatMap((asset, index) => (members.has(asset.id) ? [index] : []));
  if (positions.length === 0) return [];

  let from = Math.max(0, positions[0] - eachSide);
  let to = Math.min(ordered.length - 1, positions[positions.length - 1] + eachSide);
  ({ from, to } = stretchOverGroups(ordered, otherGroups, from, to));

  const grouped = new Set(otherGroups.flat());
  return ordered.slice(from, to + 1).map(({ id, name, ext, taken }) => ({
    id,
    name,
    ext,
    taken,
    ...(grouped.has(id) && !members.has(id) ? { inOtherGroup: true } : {}),
  }));
}

/**
 * Widens `[from, to]` until it holds every group it touches, whole.
 *
 * Repeated because one group can pull in another: reaching a sibling pano extends the window, and
 * the extension can brush against a burst beyond it. It settles within a couple of passes (each one
 * either grows the window or stops), and the album's own length bounds it.
 */
function stretchOverGroups(
  ordered: readonly AlbumAsset[],
  groups: readonly (readonly string[])[],
  from: number,
  to: number,
): { from: number; to: number } {
  const positionOf = new Map(ordered.map((asset, index) => [asset.id, index]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const group of groups) {
      const indexes = group.flatMap((id) => positionOf.get(id) ?? []);
      if (indexes.length === 0) continue;
      const first = Math.min(...indexes);
      const last = Math.max(...indexes);
      if (last < from || first > to) continue; // the window doesn't reach this group at all
      if (first < from) [from, changed] = [first, true];
      if (last > to) [to, changed] = [last, true];
    }
  }
  return { from, to };
}

/**
 * The frame set after tapping `id`, keeping capture order.
 *
 * Tapping a frame the pano already has takes it out again — the same gesture both ways, because the
 * ring is the statement ("this one belongs") and tapping is how you disagree with it. It stops at
 * {@link MIN_PANO_FRAMES}: below that there is no panorama left to be editing.
 */
export function toggleFrame(
  selected: readonly string[],
  id: string,
  order: readonly PanoCandidate[],
): string[] {
  const chosen = new Set(selected);
  if (chosen.has(id)) {
    if (chosen.size <= MIN_PANO_FRAMES) return [...selected];
    chosen.delete(id);
  } else {
    chosen.add(id);
  }
  return order.filter((candidate) => chosen.has(candidate.id)).map((candidate) => candidate.id);
}
