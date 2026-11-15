// What counts toward the day's sorting goal. Pure over the deck.

import { ReviewItem } from '../../photo';

/**
 * How many photographs deciding this unit judged, for the day's tally.
 *
 * A burst counts every frame in it: rejecting a frame of a burst is the same work as rejecting a
 * single photo, and a ten-frame burst settled in one go is ten photographs looked at. Every other
 * unit is one picture — a panorama or a stereo pair is judged as the single image it makes, and an
 * edit with its original is one shot.
 */
export function photographsJudged(item: ReviewItem): number {
  return item.kind === 'burst' ? item.photos.length : 1;
}

/** The day's tally: photographs judged across every decided unit of the deck. */
export function decidedPhotographs(deck: readonly ReviewItem[]): number {
  return deck
    .filter((item) => item.status !== 'backlog')
    .reduce((sum, item) => sum + photographsJudged(item), 0);
}
