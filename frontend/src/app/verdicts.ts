import { SwipeVerdict } from './photo';

/** How one verdict is named, drawn and coloured. */
export interface VerdictStyle {
  /** The word for it on a labelled button. */
  label: string;
  /** The mark for it where there is no room for a word. */
  glyph: string;
  /** What the swipe target says while you are dragging towards it, arrow and all. */
  hint: string;
  /** A CSS colour, not a class name or a token slug. */
  colour: string;
}

/** The four verdicts, described once. */
export const VERDICT_STYLE: Record<SwipeVerdict, VerdictStyle> = {
  kept: { label: 'Keep', glyph: '✓', hint: 'KEEP →', colour: 'var(--c-keep)' },
  toEdit: { label: 'Edit', glyph: '↑', hint: '↑ EDIT', colour: 'var(--c-amber)' },
  maybe: { label: 'Maybe', glyph: '↓', hint: '↓ MAYBE', colour: 'var(--c-maybe)' },
  rejected: { label: 'Reject', glyph: '✕', hint: '← REJECT', colour: 'var(--c-reject)' },
};

/**
 * All four, worst to best — the order a screen uses when it offers the whole set.
 *
 * Not every screen does: the review card offers three (Maybe is a swipe, for want of room) and the
 * reconsider screen turns it around to put Keep first, each saying so where it says it. So this is
 * the order for showing all four, not a rule the app follows everywhere.
 */
export const VERDICTS_IN_ORDER: readonly SwipeVerdict[] = ['rejected', 'maybe', 'toEdit', 'kept'];
