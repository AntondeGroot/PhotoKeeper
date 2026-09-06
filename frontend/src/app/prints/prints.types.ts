import { AlbumGroup, Photo } from '../photo';

/**
 * Where an album sits in the print journey, keyed by album name.
 *
 * Absent means its photos have not been ordered yet — whether or not they have been put in a print
 * album, which is a separate fact the bins record. 'ordered' means the order has been placed and the
 * prints are on their way. 'done' means the album needs nothing further.
 *
 * The last one is deliberately not 'received' or 'printed'. Those describe one way of finishing, and
 * an album of nothing but keepsakes — every photo kept, none of them printed — is just as finished
 * without a single print ever being ordered, let alone arriving. 'done' is also the only word here
 * that is not already spoken for: a *finished* album means one where every photo has been dealt
 * with, which is what puts it on this tab in the first place (see FinishedAlbumsService).
 *
 * The steps are the user's to declare. Nothing about ordering or delivery is visible to the app —
 * Lightroom does not know, and the print shop is not talking to it — so each is a button, and the
 * only one that changes anything outside the phone is the one before them all, which puts the photos
 * in a print album.
 */
export type AlbumPrintState = 'ordered' | 'done';

/**
 * A stored state in today's vocabulary.
 *
 * Albums completed before this step was named carry 'placed', which meant the prints were up on the
 * wall — one step further along, and the same end of the road. Read forward rather than migrated:
 * it is one value, and clearing the store would ask people to remember by hand which albums they
 * had already dealt with.
 *
 * Anything unrecognised reads as done rather than as ordered, which is the safe way round: an album
 * wrongly called done sits quietly in the last lane, where one wrongly called ordered would wait
 * forever for prints nobody sent.
 */
export function normalisePrintState(stored: string): AlbumPrintState {
  return stored === 'ordered' ? 'ordered' : 'done';
}

/**
 * One print bin's contents: the album whose chosen photos were sent into it, and when.
 *
 * Kept because the app can never look this up again. Lightroom's API cannot take a photo out of an
 * album, so a bin is not a queue the app can drain — it is a record of one order, and the only way
 * it empties is the user clearing it in Lightroom and saying so.
 */
export interface PrintBin {
  /** The source album whose print set is sitting in this bin. */
  album: string;
  /** How many photos were sent, so the card can say what is in there without re-reading Lightroom. */
  photos: number;
  sentAt: number;
}

/**
 * The photos in a finished album that will actually be ordered: everything except the ones set
 * aside as "keep it, don't print it". Printing is the default, so this is the whole album minus its
 * exceptions.
 */
export function printsIn(group: AlbumGroup): Photo[] {
  return group.photos.filter((photo) => !photo.saveOnly);
}

/**
 * The first bin with nothing in it, or null when they are all full.
 *
 * Bins are filled in name order rather than by any cleverness: with one bin there is no choice to
 * make, and with several the user wants "the next empty one", which is what reading down the list
 * means.
 */
export function firstFreeBin(
  bins: readonly string[],
  occupied: ReadonlyMap<string, PrintBin>,
): string | null {
  return bins.find((bin) => !occupied.has(bin)) ?? null;
}
