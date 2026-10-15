import {
  EditBaseline,
  EditVerdict,
  describeFailure,
  edited,
  stampMoved,
  verdictFor,
} from './edit-detection';

const baseline = (hash?: string, updated?: string): EditBaseline => ({ hash, updated, at: 0 });

describe('stampMoved', () => {
  it('says no when Lightroom reports the same revision it did before', () => {
    expect(stampMoved(baseline('aa', '2026-01-01T00:00:00Z'), '2026-01-01T00:00:00Z')).toBe(false);
  });

  it('says yes when the revision has moved on', () => {
    expect(stampMoved(baseline('aa', '2026-01-01T00:00:00Z'), '2026-02-02T00:00:00Z')).toBe(true);
  });

  /**
   * Without a recorded stamp the cheap check can rule nothing out, so it must not rule anything out:
   * saying "unmoved" would skip the hash and declare an edited photo untouched.
   */
  it('defers to the expensive check when there is no stamp to compare', () => {
    expect(stampMoved(baseline('aa'), '2026-01-01T00:00:00Z')).toBe(true);
    expect(stampMoved(undefined, '2026-01-01T00:00:00Z')).toBe(true);
  });
});

describe('verdictFor', () => {
  const then = '2026-01-01T00:00:00Z';
  const now = '2026-02-02T00:00:00Z';

  it('leaves a photo whose revision never moved alone, without hashing it', () => {
    expect(verdictFor('a', baseline('aa', then), then)).toEqual({
      assetId: 'a',
      state: 'untouched',
      updated: then,
    });
  });

  it('calls it edited when the picture itself changed', () => {
    expect(verdictFor('a', baseline('aa', then), now, 'bb').state).toBe('edited');
  });

  /**
   * The case the hash exists for. A rating, a keyword or an album membership moves the revision
   * without touching the photograph — and sending that to print would print the version that was
   * already there.
   */
  it('calls it touched when the revision moved but the picture did not', () => {
    expect(verdictFor('a', baseline('aa', then), now, 'aa').state).toBe('touched');
  });

  it('admits to not knowing when there is no baseline picture to compare', () => {
    expect(verdictFor('a', baseline(undefined, then), now, 'bb').state).toBe('unknown');
    expect(verdictFor('a', undefined, now, 'bb').state).toBe('unknown');
  });

  /** Re-baselining needs what was seen now, so it is carried on the verdict rather than re-fetched. */
  it('carries what it saw, so the answer can become the next baseline', () => {
    expect(verdictFor('a', baseline('aa', then), now, 'bb')).toMatchObject({
      updated: now,
      hash: 'bb',
    });
  });
});

describe('edited', () => {
  it('offers only the photos whose picture changed', () => {
    const verdicts: EditVerdict[] = [
      { assetId: 'a', state: 'edited' },
      { assetId: 'b', state: 'touched' },
      { assetId: 'c', state: 'untouched' },
      { assetId: 'd', state: 'unknown' },
    ];

    expect(edited(verdicts).map((v) => v.assetId)).toEqual(['a']);
  });
});

/**
 * The check used to throw its reason away, so every kind of trouble read as "couldn't read your
 * KeeperEdit album just now" — which is where a diagnosis starts and cannot go any further.
 */
describe('describing what went wrong', () => {
  it('names the status a server answered with', () => {
    expect(describeFailure({ status: 504, statusText: 'Gateway Timeout' })).toContain('HTTP 504');
  });

  /** Status 0 is not a reply at all — the request never got anywhere — and reads as one if left bare. */
  it('says plainly when there was no reply', () => {
    expect(describeFailure({ status: 0, statusText: 'Unknown Error' })).toContain('no reply');
  });

  it('includes what was being asked for, when it is known', () => {
    const said = describeFailure({ status: 500, statusText: '', url: 'api/albums/al-9/assets' });

    expect(said).toContain('api/albums/al-9/assets');
  });

  it('falls back to an ordinary error message', () => {
    expect(describeFailure(new Error('no KeeperEdit album'))).toBe('no KeeperEdit album');
  });

  it('says something for whatever it is handed', () => {
    expect(describeFailure('odd')).toBe('odd');
  });
});
