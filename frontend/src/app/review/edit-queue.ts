/**
 * How much of the edit queue may be sent to Lightroom, and which of it goes first.
 *
 * KeeperEdit is a working set, not a backlog. Four hundred photographs waiting to be edited is the
 * same pile the app was built to clear, moved somewhere else and no longer countable — so the album
 * is held to a size someone can actually work through, and the rest waits on the phone.
 *
 * Holding the line on the way *in* is the only option there is: Lightroom's partner scope can add a
 * photo to an album and can never take one out, so an album allowed to overfill stays overfilled
 * until the user empties it by hand.
 */

/** A photograph decided "to edit" and not yet sent to Lightroom. */
export interface WaitingPhoto {
  assetId: string;
  /** When the decision was made, so the queue is drained oldest-first. */
  decidedAt: number;
  /**
   * What the photograph is part of — a panorama's frames share one, a single photo has its own.
   *
   * A sweep is one photograph to the person editing it: its frames are stitched into one picture, so
   * sending half of them is sending nothing anybody can work with.
   */
  unitKey: string;
}

/**
 * Which photographs to send now, oldest decision first, whole units at a time.
 *
 * <p>Oldest first rather than album by album. Verdicts arrive in runs from the same shoot anyway —
 * that is how a day's reviewing goes — so time order already groups them enough that editing
 * settings can be copied from one to the next, while an album-first rule would fill the whole queue
 * from one event and make the editing a chore.
 *
 * <p>A unit is never split, even when it does not fit. Room for one more photograph and a
 * five-frame panorama next in line means the panorama goes: it is one photograph as far as the
 * editing is concerned, and the alternative — skip it and take a single instead — would leave a
 * sweep waiting for ever behind photographs that keep arriving.
 */
export function photosToFile(waiting: readonly WaitingPhoto[], room: number): string[] {
  if (room <= 0) return [];

  const units = new Map<string, WaitingPhoto[]>();
  for (const photo of waiting) {
    units.set(photo.unitKey, [...(units.get(photo.unitKey) ?? []), photo]);
  }

  const oldestFirst = [...units.values()].sort((a, b) => decidedAt(a) - decidedAt(b));
  const chosen: string[] = [];
  let left = room;
  for (const unit of oldestFirst) {
    if (left <= 0) break;
    chosen.push(...unit.map((photo) => photo.assetId));
    // Deliberately allowed to go negative: the unit that crosses the line goes whole, and the next
    // sweep sees the album over its cap and sends nothing until it is worked down again.
    left -= unit.length;
  }
  return chosen;
}

/** When a unit was decided: the earliest of its frames, since they were decided together. */
function decidedAt(unit: readonly WaitingPhoto[]): number {
  return Math.min(...unit.map((photo) => photo.decidedAt));
}
