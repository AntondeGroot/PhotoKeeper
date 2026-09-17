import { shotSets } from './shot-sets';

const names = (...pairs: [string, string][]) => new Map(pairs);
const shotOf = (sets: Map<string, string[]>, id: string) =>
  [...(sets.get(id) ?? [])].sort((a, b) => a.localeCompare(b));

describe('which files are the same photograph', () => {
  /** The one that started this: tagging a shot and then being asked about its own denoise. */
  it('joins a photograph to the denoise Lightroom wrote beside it', () => {
    const sets = shotSets({
      names: names(['raw', 'DSC_1878'], ['dng', 'DSC_1878-Enhanced-NR']),
      groups: [],
      merges: [],
    });

    expect(shotOf(sets, 'raw')).toEqual(['dng', 'raw']);
  });

  it('joins the frames of a sweep to each other', () => {
    const sets = shotSets({
      names: names(['f1', 'DSC_1'], ['f2', 'DSC_2'], ['f3', 'DSC_3']),
      groups: [['f1', 'f2', 'f3']],
      merges: [],
    });

    expect(shotOf(sets, 'f2')).toEqual(['f1', 'f2', 'f3']);
  });

  it('joins a panorama to the frames it was stitched from', () => {
    const sets = shotSets({
      names: names(['f1', 'DSC_1'], ['f2', 'DSC_2'], ['pano', 'DSC_2-Pano']),
      groups: [['f1', 'f2']],
      merges: [],
    });

    expect(shotOf(sets, 'pano')).toEqual(['f1', 'f2', 'pano']);
  });

  /** A merge already settled says outright what it came from, whatever the names look like. */
  it('joins what a recorded merge says belongs together', () => {
    const sets = shotSets({
      names: names(['a', 'A'], ['b', 'B'], ['merged', 'Merged']),
      groups: [],
      merges: [['merged', 'a', 'b']],
    });

    expect(shotOf(sets, 'a')).toEqual(['a', 'b', 'merged']);
  });

  /**
   * The three sources join up rather than sitting apart: a sweep, its panorama, and the denoise of
   * one of its frames are one photograph, not three.
   */
  it('joins a chain of relationships into one shot', () => {
    const sets = shotSets({
      names: names(
        ['f1', 'DSC_1'],
        ['f2', 'DSC_2'],
        ['dng', 'DSC_1-Enhanced-NR'],
        ['pano', 'DSC_2-Pano'],
      ),
      groups: [['f1', 'f2']],
      merges: [],
    });

    expect(shotOf(sets, 'dng')).toEqual(['dng', 'f1', 'f2', 'pano']);
  });

  /** Brackets stitched in two passes: the stitch joins the HDR, and the HDR joins the brackets. */
  it('joins a two-pass merge through the photograph in the middle', () => {
    const sets = shotSets({
      names: names(['raw', 'DSC_1'], ['hdr', 'DSC_1-HDR'], ['stitch', 'DSC_1-HDR-Pano']),
      groups: [],
      merges: [],
    });

    expect(shotOf(sets, 'stitch')).toEqual(['hdr', 'raw', 'stitch']);
  });

  it('leaves unrelated photographs alone', () => {
    const sets = shotSets({
      names: names(['a', 'DSC_1'], ['b', 'DSC_9']),
      groups: [],
      merges: [],
    });

    expect(shotOf(sets, 'a')).toEqual(['a']);
    expect(shotOf(sets, 'b')).toEqual(['b']);
  });

  /** A derived file whose original is not on this device stands alone rather than guessing. */
  it('leaves a derived file alone when its source is not there', () => {
    const sets = shotSets({ names: names(['dng', 'DSC_1-Enhanced-NR']), groups: [], merges: [] });

    expect(shotOf(sets, 'dng')).toEqual(['dng']);
  });
});
