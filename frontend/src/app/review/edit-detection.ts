// Working out which photos in the edit queue have actually been edited.
//
// Two signals, used in that order because they cost wildly different amounts. Lightroom's `updated`
// stamp arrives free with any album listing, so it narrows the field for nothing; the perceptual
// hash needs a rendition downloaded per photo, so it is spent only on what the stamp has already
// flagged. A probe against the live API established that adding a photo to an album does *not* move
// the stamp — so filing into KeeperEdit cannot make an untouched photo look edited.

/**
 * What a photo looked like when it was sent off to be edited.
 *
 * The pair is deliberate: `updated` is Lightroom's revision stamp, which comes back free with any
 * album listing and so makes a cheap first pass, while `hash` is the perceptual hash, which costs a
 * rendition download but is the only one that answers whether the *picture* changed rather than some
 * metadata about it.
 *
 * Kept apart from the detection stores it is copied from. `assetHash` and the album manifests are
 * rewritten by every re-scan, so a scan that ran after an edit would quietly move the baseline to
 * the edited state and the edit would never be found.
 */
export interface EditBaseline {
  /** Perceptual hash at the moment of sending to edit; absent if the photo had never been hashed. */
  hash?: string;
  /** Lightroom's revision stamp at that moment; absent if the album had never been scanned. */
  updated?: string;
  at: number;
}

/** Where a photo in the edit queue stands, as far as the app can tell. */
export type EditState =
  /** The stamp has not moved since it was sent to edit: nothing has happened to it. */
  | 'untouched'
  /** The stamp moved and the picture changed with it — this is an edit. */
  | 'edited'
  /**
   * The stamp moved but the picture did not.
   *
   * A rating, a keyword, an album membership — something about the photo changed without the
   * photograph changing. Reported separately rather than as an edit, because sending it to print
   * would be sending the version that was already there.
   */
  | 'touched'
  /** No baseline to compare against, so nothing can be concluded. */
  | 'unknown';

/** One photo's standing, and what to record if the user re-baselines it. */
export interface EditVerdict {
  assetId: string;
  state: EditState;
  /** The stamp seen now, for re-baselining without asking Lightroom again. */
  updated?: string;
  /** The hash seen now — only computed when the stamp moved, so absent otherwise. */
  hash?: string;
}

/** Whether the stamp has moved, which is the cheap question asked of every photo first. */
export function stampMoved(
  baseline: EditBaseline | undefined,
  updated: string | undefined,
): boolean {
  // No baseline stamp means the album was never scanned before the photo was sent to edit, so the
  // stamp cannot rule anything out and the expensive check has to decide.
  if (!baseline?.updated) return true;
  return baseline.updated !== updated;
}

/**
 * What the two signals together say about one photo.
 *
 * `hash` is the freshly computed one, and is only passed when {@link stampMoved} said it was worth
 * computing. Without a baseline hash there is nothing to compare it to, and the honest answer is
 * that we do not know rather than that it was edited.
 */
export function verdictFor(
  assetId: string,
  baseline: EditBaseline | undefined,
  updated: string | undefined,
  hash?: string,
): EditVerdict {
  if (!stampMoved(baseline, updated)) return { assetId, state: 'untouched', updated };
  if (!baseline?.hash || !hash) return { assetId, state: 'unknown', updated, hash };
  return { assetId, state: baseline.hash === hash ? 'touched' : 'edited', updated, hash };
}

/**
 * The photos worth putting in front of the user: the ones whose picture actually changed.
 *
 * Generic so a caller that has attached more to each verdict — a filename, say — gets its own shape
 * back rather than having to widen it again.
 */
export function edited<T extends EditVerdict>(verdicts: readonly T[]): T[] {
  return verdicts.filter((v) => v.state === 'edited');
}
