import { MergedPhoto, findMerges, mergeKind, mergeSourceNames } from './merged-photo';

const file = (id: string, name: string) => ({ id, name });

/** A sweep of three, its last frame being the one Lightroom happens to name the merge after. */
const SWEEP = [file('f1', 'DSC_6468'), file('f2', 'DSC_6469'), file('f3', 'DSC_6470')];
const merged = file('m1', 'DSC_6470-Pano');

const allQueued = () => true;
const asOneSet = (id: string) => (SWEEP.some((f) => f.id === id) ? ['f1', 'f2', 'f3'] : undefined);
const ids = (merges: MergedPhoto[]) => merges.map((merge) => merge.mergedId);

describe('what a merged name says a photograph is', () => {
  it('reads a panorama', () => {
    expect(mergeKind('DSC_6470-Pano')).toBe('panorama');
  });

  it('reads an HDR', () => {
    expect(mergeKind('DSC_6470-HDR')).toBe('HDR photo');
  });

  /** Brackets stitched into a sweep: both suffixes, and it is neither one alone. */
  it('reads brackets stitched into a sweep as both', () => {
    expect(mergeKind('DSC_6470-HDR-Pano')).toBe('HDR panorama');
  });

  /** Merge the same photographs twice and Lightroom numbers the second. */
  it('reads a numbered merge the same way', () => {
    expect(mergeKind('DSC_6470-Pano-2')).toBe('panorama');
    expect(mergeKind('DSC_6470-HDR-Pano-3')).toBe('HDR panorama');
  });

  it('is not fooled by an ordinary photograph', () => {
    expect(mergeKind('DSC_6470')).toBeNull();
  });

  /**
   * A denoise is a different thing entirely — one photograph re-rendered, not several combined — and
   * the app already folds those into a before/after card. Claiming it as a merge would take a
   * photograph that has an original and say it had a whole set behind it.
   */
  it('is not fooled by an edit of a single photograph', () => {
    expect(mergeKind('DSC_6470-Enhanced-NR')).toBeNull();
  });
});

/**
 * A two-pass merge leaves a photograph in the middle: brackets become `DSC_1-HDR`, and stitching
 * those gives `DSC_1-HDR-Pano`. Done in one pass the middle name never existed. Both are offered,
 * nearest first, so the caller can take whichever the library actually holds.
 */
describe('the names a merge could have come from', () => {
  it('offers the nearest source first', () => {
    expect(mergeSourceNames('DSC_1-HDR-Pano')).toEqual(['DSC_1-HDR', 'DSC_1']);
  });

  it('offers the one source of a single merge', () => {
    expect(mergeSourceNames('DSC_1-Pano')).toEqual(['DSC_1']);
  });

  it('offers nothing for a photograph that is not a merge', () => {
    expect(mergeSourceNames('DSC_1')).toEqual([]);
  });
});

describe('finding merges', () => {
  it('links a merge to the whole set it came from', () => {
    const merges = findMerges([...SWEEP, merged], allQueued, asOneSet);

    expect(merges).toEqual([
      {
        mergedId: 'm1',
        mergedName: 'DSC_6470-Pano',
        kind: 'panorama',
        frameIds: ['f1', 'f2', 'f3'],
      },
    ]);
  });

  /** The brackets an HDR is merged from are near-identical frames seconds apart — so, a burst. */
  it('links an HDR to the bracket it came from', () => {
    const hdr = file('h1', 'DSC_6470-HDR');

    const merges = findMerges([...SWEEP, hdr], allQueued, asOneSet);

    expect(merges).toEqual([
      {
        mergedId: 'h1',
        mergedName: 'DSC_6470-HDR',
        kind: 'HDR photo',
        frameIds: ['f1', 'f2', 'f3'],
      },
    ]);
  });

  /**
   * Merged in two passes, the HDR is a photograph in its own right and the true source of the
   * stitch. Linking past it to the bracket frames would claim the stitch was made from photographs
   * it was never given.
   */
  it('links a stitch to the HDR it was made from, when that exists', () => {
    const hdr = file('h1', 'DSC_6470-HDR');
    const stitched = file('s1', 'DSC_6470-HDR-Pano');

    const merges = findMerges([...SWEEP, hdr, stitched], allQueued, (id) =>
      id === 'h1' ? undefined : asOneSet(id),
    );

    expect(merges.find((m) => m.mergedId === 's1')?.frameIds).toEqual(['h1']);
  });

  /** Merged in one pass, that middle photograph never existed, so the brackets are the source. */
  it('links a stitch to the frames when there is no HDR in between', () => {
    const stitched = file('s1', 'DSC_6470-HDR-Pano');

    const merges = findMerges([...SWEEP, stitched], allQueued, asOneSet);

    expect(merges.find((m) => m.mergedId === 's1')?.frameIds).toEqual(['f1', 'f2', 'f3']);
  });

  /**
   * A set the app never grouped — merged out of photographs it only ever saw one at a time — still
   * links back to the frame the merge is named after. Half a link is worth more than none: that
   * frame is what leaves the edit queue, and the merge is still tracked from then on.
   */
  it('falls back to the one frame it can name', () => {
    const merges = findMerges([...SWEEP, merged], allQueued, () => undefined);

    expect(merges[0].frameIds).toEqual(['f3']);
  });

  /**
   * The merge is only news while its sources are waiting on an edit. One merged before the app ever
   * saw the library is just a photograph in it, and offering to "finish" it would be inventing work
   * nobody asked for.
   */
  it('says nothing about a merge whose frames are not waiting to be edited', () => {
    expect(findMerges([...SWEEP, merged], () => false, asOneSet)).toEqual([]);
  });

  /** The frame it was named after may be gone from the library; there is then nothing to link. */
  it('says nothing about a merge whose source it cannot find', () => {
    expect(findMerges([merged], allQueued, asOneSet)).toEqual([]);
  });

  it('finds each merge of the same set', () => {
    const again = file('m2', 'DSC_6470-Pano-2');

    expect(ids(findMerges([...SWEEP, merged, again], allQueued, asOneSet))).toEqual(['m1', 'm2']);
  });

  it('says nothing where there is no merge at all', () => {
    expect(findMerges(SWEEP, allQueued, asOneSet)).toEqual([]);
  });
});
