import { isUnitId } from '../photo';

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

/**
 * How long a photograph may sit in KeeperEdit unedited before editing it becomes the price of
 * getting any new ones.
 *
 * A month, because that is long enough to be a considered choice not to edit something and short
 * enough that the album cannot quietly fill with photographs nobody will ever get to. The cap alone
 * does not manage that: work through the easy half of an album and the queue tops itself up for
 * ever, while the same few difficult photographs sit at the bottom being overtaken.
 */
export const MANDATORY_AFTER_DAYS = 30;

/** A photograph sitting in the edit album, and when it was sent there. */
export interface QueuedPhoto {
  assetId: string;
  name: string;
  /** When it was sent to be edited. Zero for one sent before the app kept a record — long ago. */
  decidedAt: number;
}

/**
 * The photographs that have waited too long, oldest first.
 *
 * These are the ones that must be dealt with before the album takes anything new. Any photograph can
 * be edited in any order — the point is not to dictate what to work on, but that the album drains
 * towards the things that have been avoided rather than around them.
 */
export function overdueEdits(
  inAlbum: readonly QueuedPhoto[],
  now: number,
  days: number = MANDATORY_AFTER_DAYS,
): QueuedPhoto[] {
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  return inAlbum
    .filter((photo) => photo.decidedAt <= cutoff)
    .sort((a, b) => a.decidedAt - b.decidedAt);
}

/** What the app can say about the edit album without asking Lightroom anything. */
export interface EditQueueState {
  /** How many photographs the album is believed to hold. */
  held: number;
  /** Those that have been in it, unedited, for over a month — longest wait first. */
  mandatory: QueuedPhoto[];
}

/**
 * The state of the edit album as the app's own records describe it.
 *
 * Worked out from what has been filed rather than from what Lightroom says, because the answer is
 * wanted the instant the screen opens and a listing of four hundred photographs is a request that
 * takes a while — long enough that the tab said the queue was clear, and then corrected itself once
 * the answer arrived. The records are on the device and the answer is immediate.
 *
 * It is an estimate in exactly one direction: a photograph the user has removed from the album by
 * hand is still on record as filed, so this can only ever over-count. That is the safe way round —
 * it never invites more photographs into an album that is already full — and the listing that
 * follows corrects it.
 *
 * The clock is the filing, not the decision: the question is how long a photograph has been sitting
 * in the album, and it starts sitting there when it is put there.
 */
export function editQueueFromRecords(
  filed: ReadonlyMap<string, { albums: readonly string[]; at: number }>,
  album: string,
  isUnfinished: (assetId: string) => boolean,
  nameOf: (assetId: string) => string,
  now: number,
): EditQueueState {
  const inAlbum: QueuedPhoto[] = [];
  let held = 0;
  for (const [assetId, record] of filed) {
    if (!record.albums.includes(album)) continue;
    // A burst or panorama card's own id is not a photograph, and Lightroom has never held one. Some
    // are on record from before filing learned to skip them; counted here they would fill the album
    // with things that are not in it, and be offered for editing as ids nobody can open.
    if (isUnitId(assetId)) continue;
    held++;
    // Finished photographs stay in the album for good — Lightroom will not take one out — so they
    // fill it, but they are nobody's unfinished business and can never become mandatory.
    if (isUnfinished(assetId)) {
      inAlbum.push({ assetId, name: nameOf(assetId), decidedAt: record.at });
    }
  }
  return { held, mandatory: overdueEdits(inAlbum, now) };
}
