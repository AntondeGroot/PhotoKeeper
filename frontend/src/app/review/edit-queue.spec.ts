import { WaitingPhoto, editQueueFromRecords, overdueEdits, photosToFile } from './edit-queue';

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

/**
 * The cap alone does not stop a backlog forming: work through the easy half of an album and the
 * queue tops itself up for ever, while the same few difficult photographs sit at the bottom being
 * overtaken by whatever was decided this morning.
 */
describe('photographs that have waited too long', () => {
  const day = 24 * 60 * 60 * 1000;
  const now = 1_000 * day;
  const queued = (assetId: string, decidedAt: number) => ({ assetId, name: assetId, decidedAt });

  it('names one that has been waiting over a month', () => {
    const waiting = [queued('old', now - 31 * day), queued('fresh', now - 3 * day)];

    expect(overdueEdits(waiting, now).map((p) => p.assetId)).toEqual(['old']);
  });

  it('leaves alone one that has waited exactly less than the month', () => {
    expect(overdueEdits([queued('a', now - 29 * day)], now)).toEqual([]);
  });

  /** A month to the day counts: the boundary belongs to the side that makes the rule bite. */
  it('counts one that reached the month today', () => {
    expect(overdueEdits([queued('a', now - 30 * day)], now).map((p) => p.assetId)).toEqual(['a']);
  });

  /** Longest-waiting first, so the list reads as what has been avoided the most. */
  it('puts the longest wait first', () => {
    const waiting = [queued('b', now - 40 * day), queued('a', now - 90 * day)];

    expect(overdueEdits(waiting, now).map((p) => p.assetId)).toEqual(['a', 'b']);
  });

  /** Sent before the app kept a record of when: certainly long ago, and certainly not recent. */
  it('treats a photograph with no date as long overdue', () => {
    expect(overdueEdits([queued('a', 0)], now).map((p) => p.assetId)).toEqual(['a']);
  });

  it('says nothing when everything is recent', () => {
    expect(overdueEdits([queued('a', now - day)], now)).toEqual([]);
  });
});

/**
 * The answer the Edit tab needs the moment it opens. Asking Lightroom means listing every photograph
 * in the album, which on a full one takes long enough that the tab said the queue was clear and then
 * corrected itself — so this answers from what the app has filed, which is on the device.
 */
describe('the edit album as the records describe it', () => {
  const day = 24 * 60 * 60 * 1000;
  const now = 1_000 * day;
  const filedAt = (albums: string[], at: number) => ({ albums, at });
  const named = (id: string) => `${id}.NEF`;

  function state(filed: Map<string, { albums: string[]; at: number }>, unfinished: Set<string>) {
    return editQueueFromRecords(filed, 'KeeperEdit', (id) => unfinished.has(id), named, now);
  }

  it('counts everything filed into the album', () => {
    const filed = new Map([
      ['a', filedAt(['KeeperEdit'], now)],
      ['b', filedAt(['KeeperEdit'], now)],
      ['c', filedAt(['KeeperDelete'], now)],
    ]);

    expect(state(filed, new Set(['a', 'b'])).held).toBe(2);
  });

  /**
   * Finished photographs cannot be taken out of the album, so they fill it — but they are nobody's
   * unfinished business and can never be the reason nothing new arrives.
   */
  it('counts a finished photograph as filling the album, never as overdue', () => {
    const filed = new Map([['done', filedAt(['KeeperEdit'], now - 90 * day)]]);

    expect(state(filed, new Set())).toEqual({ held: 1, mandatory: [] });
  });

  /** The clock is the filing: a photograph starts waiting when it is put in the album. */
  it('names one that has been in the album over a month', () => {
    const filed = new Map([
      ['old', filedAt(['KeeperEdit'], now - 40 * day)],
      ['new', filedAt(['KeeperEdit'], now - day)],
    ]);

    const { mandatory } = state(filed, new Set(['old', 'new']));

    expect(mandatory.map((p) => p.assetId)).toEqual(['old']);
    expect(mandatory[0].name).toBe('old.NEF');
  });

  it('says the album is empty when nothing has been filed into it', () => {
    expect(state(new Map(), new Set())).toEqual({ held: 0, mandatory: [] });
  });
});
