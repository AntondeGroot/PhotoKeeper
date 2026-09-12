import { PhotoAsset } from './lightroom-types';
import { editPairs, editsWithOriginal, pairEditsToOriginals } from './edit-pairs';

const asset = (id: string, fileName: string): PhotoAsset => ({
  id,
  subtype: 'image',
  payload: { importSource: { fileName } },
});

/**
 * What counts as one photograph in two files. Read by two very different callers — selection, to
 * fold the pair into a single before/after card, and the scan, to keep the pair out of detection —
 * so the rule is stated once and checked here.
 */
describe('edit pairs', () => {
  it('pairs an edit with the original it was written beside', () => {
    const original = asset('o', 'DSC_1891.NEF');
    const edit = asset('e', 'DSC_1891-Enhanced-NR.dng');

    expect(editPairs([original, edit]).get('e')).toBe(original);
  });

  it('recognises every suffix Lightroom writes', () => {
    const files = [
      { id: 'o', name: 'DSC_1' },
      { id: 'a', name: 'DSC_1-Enhanced-NR' },
      { id: 'b', name: 'DSC_1-Enhanced' },
      { id: 'c', name: 'DSC_1-Edit' },
    ];

    expect(new Set(pairEditsToOriginals(files).keys())).toEqual(new Set(['a', 'b', 'c']));
  });

  /**
   * A merge of *several* originals is a photograph of its own — there is no single shot behind it to
   * fold it into, and it is a real burst candidate besides.
   */
  it('does not treat a panorama or an HDR as an edit', () => {
    const files = [
      { id: 'o', name: 'DSC_1' },
      { id: 'p', name: 'DSC_1-Pano' },
      { id: 'h', name: 'DSC_1-HDR' },
    ];

    expect(pairEditsToOriginals(files).size).toBe(0);
  });

  it('leaves an edit unpaired when its original is not there', () => {
    expect(editPairs([asset('e', 'DSC_1891-Enhanced-NR.dng')]).size).toBe(0);
  });

  /** Lightroom is not consistent about case, and a pair that failed to match would be offered twice. */
  it('matches the stem whatever its case', () => {
    const files = [
      { id: 'o', name: 'dsc_1891' },
      { id: 'e', name: 'DSC_1891-enhanced-nr' },
    ];

    expect(pairEditsToOriginals(files).get('e')).toBe('o');
  });

  /** Detection is told which files to skip, and it must be the edits — never the photographs. */
  it('names the edit as the one to keep out of detection, not the original', () => {
    const ids = editsWithOriginal([asset('o', 'DSC_1.NEF'), asset('e', 'DSC_1-Enhanced-NR.dng')]);

    expect([...ids]).toEqual(['e']);
  });
});
