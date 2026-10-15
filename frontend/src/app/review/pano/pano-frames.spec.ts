import { AlbumAsset, MIN_PANO_FRAMES, candidateWindow, toggleFrame } from './pano-frames';

/** An album shot straight through: one frame a second, named in order. */
function album(count: number): AlbumAsset[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `a${i}`,
    name: `DSC_${1000 + i}`,
    ext: 'NEF',
    taken: `2026-05-24T10:00:${String(i).padStart(2, '0')}`,
  }));
}

describe('candidateWindow', () => {
  it('offers the frames either side of the detected run', () => {
    const window = candidateWindow(['a5', 'a6'], album(20), 2);

    expect(window.map((c) => c.id)).toEqual(['a3', 'a4', 'a5', 'a6', 'a7', 'a8']);
  });

  it('includes a photo detection skipped in the middle of the run', () => {
    // A gap inside the sweep is as likely as a short end, and invisible in the card itself.
    const window = candidateWindow(['a5', 'a7'], album(20), 1);

    expect(window.map((c) => c.id)).toEqual(['a4', 'a5', 'a6', 'a7', 'a8']);
  });

  it('stops at the ends of the album rather than running off them', () => {
    const window = candidateWindow(['a0'], album(3), 5);

    expect(window.map((c) => c.id)).toEqual(['a0', 'a1', 'a2']);
  });

  it('orders by capture time, falling back to name for frames stamped the same second', () => {
    // A pano sweep routinely fires several frames inside one second.
    const sameSecond: AlbumAsset[] = [
      { id: 'b', name: 'DSC_2', taken: '2026-05-24T10:00:00' },
      { id: 'a', name: 'DSC_1', taken: '2026-05-24T10:00:00' },
    ];

    expect(candidateWindow(['a'], sameSecond).map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('reaches over a sibling panorama whole, rather than offering half of it', () => {
    // The case this is really for: one sweep detected as two panos. Offering only the nearest few
    // frames of the other half would let someone merge part of it — which looks finished and is not.
    const sibling = ['a8', 'a9', 'a10', 'a11'];

    const window = candidateWindow(['a5', 'a6'], album(20), 2, [sibling]);

    expect(window.map((c) => c.id)).toEqual([
      'a3',
      'a4',
      'a5',
      'a6',
      'a7',
      'a8',
      'a9',
      'a10',
      'a11',
    ]);
  });

  it('marks the sibling frames, so the strip can show they come as a set', () => {
    const window = candidateWindow(['a5'], album(20), 2, [['a6', 'a7']]);

    expect(window.filter((c) => c.inOtherGroup).map((c) => c.id)).toEqual(['a6', 'a7']);
    expect(window.find((c) => c.id === 'a5')?.inOtherGroup).toBeUndefined();
  });

  it('leaves a group the window never reaches out of it', () => {
    const window = candidateWindow(['a5'], album(20), 1, [['a15', 'a16']]);

    expect(window.map((c) => c.id)).toEqual(['a4', 'a5', 'a6']);
  });

  it('offers nothing when the pano frames are not among the scanned assets', () => {
    // Nothing scanned yet, so there is no neighbourhood to place them in.
    expect(candidateWindow(['x1'], album(5))).toEqual([]);
  });
});

describe('toggleFrame', () => {
  const order = candidateWindow(['a5'], album(20), 2);

  it('adds a neighbouring photo, keeping the frames in capture order', () => {
    expect(toggleFrame(['a5'], 'a4', order)).toEqual(['a4', 'a5']);
  });

  it('takes a frame back out when it is tapped again', () => {
    expect(toggleFrame(['a4', 'a5', 'a6'], 'a4', order)).toEqual(['a5', 'a6']);
  });

  it('refuses to shrink a panorama below two frames', () => {
    const two = ['a5', 'a6'];

    expect(toggleFrame(two, 'a6', order)).toEqual(two);
    expect(MIN_PANO_FRAMES).toBe(2);
  });
});
