import { WaitingPhoto, photosToFile } from './edit-queue';

const single = (id: string, decidedAt: number): WaitingPhoto => ({
  assetId: id,
  decidedAt,
  unitKey: id,
});

/** A sweep: several frames decided together, and one photograph as far as editing is concerned. */
const sweep = (ids: string[], decidedAt: number): WaitingPhoto[] =>
  ids.map((id) => ({ assetId: id, decidedAt, unitKey: 'pano-1' }));

describe('what the edit queue sends to Lightroom', () => {
  it('sends nothing when the album is already at its cap', () => {
    expect(photosToFile([single('a', 1)], 0)).toEqual([]);
  });

  it('sends nothing when the album is over its cap', () => {
    expect(photosToFile([single('a', 1)], -5)).toEqual([]);
  });

  it('fills the room there is', () => {
    const waiting = [single('a', 1), single('b', 2), single('c', 3)];

    expect(photosToFile(waiting, 2)).toEqual(['a', 'b']);
  });

  /**
   * Oldest decision first. A photograph decided weeks ago and still waiting should not be overtaken
   * for ever by whatever was decided this morning.
   */
  it('drains the oldest decisions first, whatever order they arrive in', () => {
    const waiting = [single('new', 300), single('old', 100), single('middle', 200)];

    expect(photosToFile(waiting, 2)).toEqual(['old', 'middle']);
  });

  /**
   * The case that shapes the rule: a panorama is one photograph to edit, so its frames go together
   * or not at all. Sending three of five would be sending something nobody can stitch.
   */
  it('sends a whole sweep even when it does not fit', () => {
    const waiting = [...sweep(['f1', 'f2', 'f3', 'f4', 'f5'], 100), single('later', 200)];

    expect(photosToFile(waiting, 1)).toEqual(['f1', 'f2', 'f3', 'f4', 'f5']);
  });

  /** Having gone over, it stops — the overflow is one unit's worth, not a licence to keep going. */
  it('stops once the room is spent', () => {
    const waiting = [...sweep(['f1', 'f2', 'f3'], 100), single('later', 200)];

    expect(photosToFile(waiting, 2)).toEqual(['f1', 'f2', 'f3']);
  });

  /** A sweep is placed by when it was decided, not by how many frames it has. */
  it('takes an older single before a newer sweep', () => {
    const waiting = [...sweep(['f1', 'f2'], 200), single('older', 100)];

    expect(photosToFile(waiting, 1)).toEqual(['older']);
  });

  it('sends everything waiting when there is room for it', () => {
    const waiting = [single('a', 1), ...sweep(['f1', 'f2'], 2)];

    expect(photosToFile(waiting, 30)).toEqual(['a', 'f1', 'f2']);
  });

  it('sends nothing when nothing is waiting', () => {
    expect(photosToFile([], 30)).toEqual([]);
  });
});
