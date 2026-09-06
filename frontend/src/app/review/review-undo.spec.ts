import { Photo } from '../photo';
import {
  DecisionOutcome,
  MAX_UNDO,
  UndoEntry,
  bringBack,
  heldAssetIds,
  pushEntry,
} from './review-undo.service';

const unit = (id: string): Photo => ({
  id,
  name: id,
  album: null,
  taken: '2026-01-01',
  status: 'backlog',
  kind: 'photo',
  starred: false,
  saveOnly: false,
});

const entry = (id: string, touched: string[], outcome: DecisionOutcome = 'kept'): UndoEntry => ({
  outcome,
  unit: unit(id),
  verdicts: new Map(touched.map((asset) => [asset, undefined])),
});

describe('undo stack', () => {
  it('drops the oldest entry once it is full, keeping the most recent decisions', () => {
    let stack: UndoEntry[] = [];
    for (let i = 0; i < MAX_UNDO + 5; i++) stack = pushEntry(stack, entry(`u${i}`, [`u${i}`]));

    expect(stack).toHaveLength(MAX_UNDO);
    expect(stack.at(0)?.unit.id).toBe('u5');
    expect(stack.at(-1)?.unit.id).toBe(`u${MAX_UNDO + 4}`);
  });

  /**
   * The set the Lightroom sweep is asked to leave alone. Album membership cannot be removed once
   * written, so a decision that is still undoable must not be filed — undoing it afterwards would
   * clear the verdict here and leave the photo in the Keeper album for good.
   */
  it('reports every asset a pending undo would touch', () => {
    const stack = [entry('a', ['a', 'b']), entry('c', ['c'], 'rejected')];

    expect(heldAssetIds(stack)).toEqual(new Set(['a', 'b', 'c']));
  });

  it('holds nothing back once the stack is empty', () => {
    expect(heldAssetIds([]).size).toBe(0);
  });
});

describe('bringBack', () => {
  /**
   * Deciding and skipping have to undo the same way. One leaves the unit on the deck carrying a
   * verdict and the other takes it off entirely, and which of those happened is not something the
   * person who pressed one button should have to know.
   */
  it('moves a decided unit to the cursor, so it is the next one judged', () => {
    const deck = [{ ...unit('a'), status: 'kept' as const }, unit('b'), unit('c')];

    const back = bringBack(deck, 1, unit('a'));

    expect(back.deck.map((u) => u.id)).toEqual(['a', 'b', 'c']);
    expect(back.index).toBe(0);
    expect(back.deck[0].status).toBe('backlog');
  });

  it('brings a skipped unit back onto a deck it had left', () => {
    const back = bringBack([unit('b'), unit('c')], 1, unit('a'));

    expect(back.deck.map((u) => u.id)).toEqual(['b', 'a', 'c']);
    expect(back.index).toBe(1);
  });

  /**
   * Undoing a decision from further back must not send the cursor there: everything between has
   * already been judged, and walking it again is not what "take that one back" asked for.
   */
  it('leaves the photos in between where they are', () => {
    const deck = ['a', 'b', 'c', 'd'].map((id) => ({ ...unit(id), status: 'kept' as const }));

    const back = bringBack(deck, 3, deck[0]);

    expect(back.deck.map((u) => u.id)).toEqual(['b', 'c', 'a', 'd']);
    expect(back.index).toBe(2);
  });

  it('appends when the cursor is past the end of what is left', () => {
    const back = bringBack([unit('a')], 9, unit('b'));

    expect(back.deck.map((u) => u.id)).toEqual(['a', 'b']);
    expect(back.index).toBe(1);
  });
});
