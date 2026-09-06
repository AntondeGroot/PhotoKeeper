import { Injectable, computed, inject, signal } from '@angular/core';
import { ReviewItem, unitAssetIds } from '../photo';
import { StoredVerdict } from '../storage/photokeeper-db';
import { ReviewStore } from '../storage/review/review-store';

// Taking back the last few decisions.
//
// An entry records the *unit* a decision changed rather than the deck it changed it in: the unit as
// it stood, and the verdict of every asset the decision was about to overwrite. Not the whole deck,
// which was the first shape and is wrong twice over — anything done to another unit afterwards
// (starring the next photo, say) would be rolled back with it, and a deck snapshot can only be
// unwound in order, which is no use to a list you scroll through and pick from.
//
// Recorded rather than derived, because the decision paths are not uniformly reversible: a burst
// writes a verdict per frame, an incomplete pair writes one per asset under a synthetic unit id, and
// skipping takes the unit off the deck altogether. An inverse per operation would need a new correct
// implementation for each of those, and another for every path added later.
//
// What is deliberately *not* recorded: the streak and the day's celebration. A day already earned is
// not revoked and a banner already seen is not un-shown. The review count needs no help either — it
// is counted off the deck, so putting the unit back corrects it.

/**
 * How many decisions can be taken back — and so how many the list shows.
 *
 * The number is also the write-back grace period: a decision still on this stack is held out of the
 * Lightroom sweep, because album membership cannot be removed once written and an undo that leaves
 * the photo in KeeperDelete is not an undo. Twenty is a screen or two of scrolling, and the cost of
 * the depth is only that the first decision of a session waits for twenty more, or for the next app
 * start.
 */
export const MAX_UNDO = 20;

/** What a decision did, as the list shows it. A skip is not a verdict — it stored none. */
export type DecisionOutcome = 'kept' | 'rejected' | 'toEdit' | 'maybe' | 'skipped';

/** One reversible decision. */
export interface UndoEntry {
  /** What was decided, for the row's chip. */
  outcome: DecisionOutcome;
  /** The unit as it stood before, with its own status. */
  unit: ReviewItem;
  /**
   * The verdict each touched asset had beforehand — `undefined` for one that had none, which has to
   * be restored as an absence rather than as a stored 'backlog', or the photo counts as decided.
   */
  verdicts: ReadonlyMap<string, StoredVerdict | undefined>;
}

/** Adds an entry, dropping the oldest once the stack is full. */
export function pushEntry(stack: readonly UndoEntry[], entry: UndoEntry): UndoEntry[] {
  return [...stack, entry].slice(-MAX_UNDO);
}

/**
 * Every asset a pending undo would touch — the ids the Lightroom sweep must leave alone.
 *
 * Taken from the verdict keys rather than from the unit, because those are exactly the assets the
 * decisions wrote: a skipped unit stored no verdict, so it has nothing to hold back.
 */
export function heldAssetIds(stack: readonly UndoEntry[]): Set<string> {
  const held = new Set<string>();
  for (const entry of stack) {
    for (const id of entry.verdicts.keys()) held.add(id);
  }
  return held;
}

/**
 * Puts a unit back at the cursor, so a photo taken back is the next one judged.
 *
 * <p>At the cursor rather than where it was, because the list can reach a decision made twenty
 * photos ago and sending the cursor back there would replay everything in between. Bringing the unit
 * forward instead answers the question the user actually asked — "let me look at that one again" —
 * and leaves the rest of the deck in the order it was in.
 *
 * <p>Deciding and skipping converge here: one left the unit on the deck carrying a verdict and the
 * other took it off entirely, and which of those happened is not something the person who pressed
 * one button should have to know.
 */
export function bringBack(
  deck: readonly ReviewItem[],
  index: number,
  unit: ReviewItem,
): { deck: ReviewItem[]; index: number } {
  const at = deck.findIndex((item) => item.id === unit.id);
  const without = at === -1 ? [...deck] : [...deck.slice(0, at), ...deck.slice(at + 1)];
  // Pulling a unit out from behind the cursor shifts everything after it left, the cursor included.
  const cursor = Math.min(at !== -1 && at < index ? index - 1 : index, without.length);
  return {
    deck: [...without.slice(0, cursor), unit, ...without.slice(cursor)],
    index: cursor,
  };
}

/**
 * The recent decisions, and taking one back.
 *
 * <p>Owns none of the deck: the caller hands over the unit as it stood and gets it back on undo.
 * That keeps the dependency one-way — this service knows only about stored verdicts — which matters
 * because the Lightroom sweep asks it what to hold back, and the deck already depends on the sweep.
 *
 * <p>Deliberately session-scoped, not persisted. After a restart the sweep has filed everything, so
 * an undo offered then could restore the app's verdict but never take the photo back out of the
 * Keeper album. Keeping the stack in memory makes "undoable" and "not yet written to Lightroom" the
 * same set without either having to track the other — and it is why the list ends where it does.
 */
@Injectable({ providedIn: 'root' })
export class ReviewUndoService {
  private readonly store = inject(ReviewStore);

  private readonly stack = signal<readonly UndoEntry[]>([]);

  /** The decisions still open to being taken back, most recent first — what the list renders. */
  readonly recent = computed(() => [...this.stack()].reverse());

  /** Whether there is anything to take back — drives the button that opens the list. */
  readonly canUndo = computed(() => this.stack().length > 0);

  /** Whether the list is on screen. Held here so the host needs no state of its own for it. */
  readonly listOpen = signal(false);

  openList(): void {
    this.listOpen.set(true);
  }

  closeList(): void {
    this.listOpen.set(false);
  }

  /**
   * Assets a pending undo would touch, which the Lightroom sweep must leave alone.
   *
   * Album membership cannot be removed once written, so filing a decision that is still on this
   * stack would make undo a half-truth: the app would forget the verdict and Lightroom would not.
   */
  heldAssetIds(): Set<string> {
    return heldAssetIds(this.stack());
  }

  /**
   * Every asset the list is showing, so their previews can be held against eviction.
   *
   * Taken from the units rather than the verdict keys, which is the other set and not this one: a
   * skipped unit stored no verdict but still has a thumbnail to draw, and a burst's frames are what
   * the row shows even though the verdict was recorded against the unit as well.
   */
  shownAssetIds(): Set<string> {
    return new Set(this.stack().flatMap((entry) => unitAssetIds(entry.unit)));
  }

  /**
   * Records a decision about to be made: the unit at the cursor, and the verdicts it will overwrite.
   *
   * <p>Must be called *before* the decision is applied. The verdicts are read synchronously for that
   * reason — {@link ReviewStore#setVerdict} writes through to the cached map, so an awaited read
   * would come back holding the new values rather than the old.
   */
  capture(outcome: DecisionOutcome, unit: ReviewItem, assetIds: string[]): void {
    const stored = this.store.loadedVerdicts();
    if (!stored) return; // verdicts never read: nothing to restore them to, so offer no undo

    const verdicts = new Map<string, StoredVerdict | undefined>();
    for (const id of assetIds) verdicts.set(id, stored.get(id));
    this.stack.update((s) => pushEntry(s, { outcome, unit, verdicts }));
  }

  /**
   * Reverses one decision — any of them, not only the last — and returns it so the caller can put the
   * unit back. Null when that entry has already been taken back.
   *
   * <p>Out of order is safe precisely because an entry describes one unit: entries do not overlap, so
   * undoing the fifth one down says nothing about the four above it.
   *
   * <p>The verdicts go back first and the caller restores the deck after, so a storage failure leaves
   * the screen agreeing with what is stored rather than showing an undo that did not happen.
   */
  async take(entry: UndoEntry): Promise<UndoEntry | null> {
    if (!this.stack().includes(entry)) return null;
    this.stack.update((s) => s.filter((e) => e !== entry));

    for (const [assetId, verdict] of entry.verdicts) {
      // An absent verdict is restored as an absence, not as a stored 'backlog': the sweep and the
      // storage report both read every stored verdict, and a placeholder would count as a decision.
      await (verdict ? this.store.setVerdict(assetId, verdict) : this.store.removeVerdict(assetId));
    }
    return entry;
  }

  /**
   * Drops everything, because the deck those units belong to no longer exists.
   *
   * Called when the day turns over or the deck is reloaded: putting a unit back into a selection it
   * was never part of would add a photograph today's deck had deliberately left out.
   */
  clear(): void {
    this.stack.set([]);
    this.listOpen.set(false);
  }
}
