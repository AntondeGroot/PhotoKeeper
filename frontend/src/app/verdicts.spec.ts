import { SwipeVerdict } from './photo';
import { VERDICT_STYLE, VERDICTS_IN_ORDER } from './verdicts';

/**
 * The bug these exist for: "to edit" was amber on the review card and teal in the undo list, and a
 * screen written later copied the wrong one — teal being `--c-print`, which means the Prints side
 * and so reads as a different answer. Five places drew these four verdicts, each with its own
 * opinion. Those five now read one description, and it is checked here. (The stereo card still
 * keeps its own: it speaks a different three-word vocabulary, and bringing it in is its own job.)
 */
describe('the verdict description', () => {
  const ALL: SwipeVerdict[] = ['kept', 'rejected', 'toEdit', 'maybe'];

  it('describes every verdict, with nothing missing', () => {
    for (const verdict of ALL) {
      const style = VERDICT_STYLE[verdict];
      expect(style.label, verdict).toBeTruthy();
      expect(style.glyph, verdict).toBeTruthy();
      expect(style.hint, verdict).toBeTruthy();
      expect(style.colour, verdict).toMatch(/^var\(--c-[a-z]+\)$/);
    }
  });

  /** The one that drifted: it read teal, which is `--c-print` and means the Prints side. */
  it('states that edit is amber, and not the Prints colour', () => {
    expect(VERDICT_STYLE.toEdit.colour).toBe('var(--c-amber)');
  });

  it('gives each verdict a colour of its own', () => {
    const colours = ALL.map((verdict) => VERDICT_STYLE[verdict].colour);

    expect(new Set(colours).size).toBe(ALL.length);
  });

  /** All four, and nothing left out — this is the order the fullscreen viewer offers them in. */
  it('lists every verdict once, worst to best', () => {
    expect(VERDICTS_IN_ORDER).toEqual(['rejected', 'maybe', 'toEdit', 'kept']);
  });
});
