import { ReviewStatus } from '../photo';

/**
 * What was true of the library on one day — a row per day, so progress can be drawn over time.
 *
 * Recorded rather than derived, because none of it can be recovered later: a verdict says what was
 * decided and never when, and the library's size is only ever knowable as it is now. A day that goes
 * unrecorded is a day the chart can never show, which is why this is written from the first launch
 * that has the numbers rather than waiting for anything to read it.
 *
 * Two sources, deliberately kept apart rather than reconciled into one number:
 *
 * - **the verdicts**, which are what the user decided, known offline and exactly;
 * - **the Keeper albums**, which are what Lightroom has actually been told.
 *
 * They disagree, and the disagreement is the interesting part: a photo rejected here is a photo
 * *asked* to be deleted, and only the album says whether it has been. The gap between the two lines
 * is the work that has been decided and not yet carried out.
 */
export interface DayCensus {
  /** Local day key, `YYYY-MM-DD` — also this row's key in the store. */
  day: string;
  /** When the device side of this row was last written (epoch ms). */
  at: number;
  /** Photographs the scan has seen. Falls when photos leave the library, so it is a live total. */
  known: number;
  /** How many carry each verdict, counted over every verdict on record. */
  verdicts: Record<ReviewStatus, number>;
  /**
   * Verdicts whose photograph the scan no longer finds — decided, and since gone from the library.
   *
   * The counterpart to {@link known} falling: without it a shrinking library and a library never
   * scanned look alike on the chart. These are mostly deletions carried out in Lightroom.
   */
  gone: number;
  /**
   * Deletions carried out, counted since the app started watching — the line that only ever rises.
   *
   * Not taken from the albums: a tombstone stands for thirty days and is then purged, so what an
   * album holds is a rolling window and nothing else. Counting that as "deleted" would draw a line
   * that climbed for a month and then fell away while the deleting was still going on. So each
   * deletion is written down the first time it is seen and counted for ever after — see
   * {@link DeletionRecord}.
   */
  deletedEver: number;
  /** What each Keeper album held when it was last looked at; absent until something looks. */
  albums?: Record<string, AlbumCensus>;
}

/**
 * One photograph, deleted in Lightroom, as first seen.
 *
 * Keyed by the id the app knew the photo by — a tombstone names it in `original.id` — so a deletion
 * is recorded once however many times it is seen, and stays recorded once the tombstone is purged
 * and Lightroom can no longer be asked about it.
 */
export interface DeletionRecord {
  /** The day it was first seen to be deleted, which is not always the day it was deleted. */
  day: string;
  /** The Keeper album it was seen in. */
  album: string;
  at: number;
}

/** One Keeper album as Lightroom last reported it. */
export interface AlbumCensus {
  /** Photographs in the album. */
  live: number;
  /**
   * Tombstones in it: photographs deleted in Lightroom, which leaves a marker in their place for
   * thirty days and then purges it. So this says how much deleting has happened *lately*, not in
   * total — {@link DayCensus.deletedEver} is the total.
   */
  deleted: number;
  /** When this album was last looked at (epoch ms) — the albums are not all read at once. */
  at: number;
}

/** An empty day, so every row has the same shape whether or not anything has been decided. */
export function emptyCensus(day: string, at: number): DayCensus {
  return {
    day,
    at,
    known: 0,
    gone: 0,
    deletedEver: 0,
    verdicts: { backlog: 0, kept: 0, rejected: 0, toEdit: 0, toPrint: 0, maybe: 0 },
  };
}
