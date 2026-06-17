import { clusterBursts, DetectAsset, BurstOptions } from './burst';

const OPTS: BurstOptions = { windowMs: 2000, maxHamming: 10, minSize: 2 };

const SAME = 'aaaaaaaaaaaaaaaa'; // identical hashes → Hamming distance 0
const FAR = '0000000000000000'; // vs SAME: distance 32 → exceeds maxHamming

function asset(id: string, secondsFromBase: number, camera = 'cam-1'): DetectAsset {
  const base = Date.parse('2026-05-24T10:00:00.000Z');
  return { id, taken: new Date(base + secondsFromBase * 1000).toISOString(), camera };
}

describe('clusterBursts', () => {
  it('groups a run of close, same-camera, near-identical frames', () => {
    const assets = [asset('b1', 0), asset('b2', 1), asset('b3', 2)];
    const hashes = new Map([
      ['b1', SAME],
      ['b2', SAME],
      ['b3', SAME],
    ]);

    expect(clusterBursts(assets, hashes, OPTS)).toEqual([{ memberIds: ['b1', 'b2', 'b3'] }]);
  });

  it('sorts by capture time regardless of input order', () => {
    const assets = [asset('b3', 2), asset('b1', 0), asset('b2', 1)];
    const hashes = new Map([
      ['b1', SAME],
      ['b2', SAME],
      ['b3', SAME],
    ]);

    expect(clusterBursts(assets, hashes, OPTS)).toEqual([{ memberIds: ['b1', 'b2', 'b3'] }]);
  });

  it('splits when the time gap exceeds the window', () => {
    const assets = [asset('b1', 0), asset('b2', 1), asset('b3', 10)]; // 9s gap before b3
    const hashes = new Map([
      ['b1', SAME],
      ['b2', SAME],
      ['b3', SAME],
    ]);

    // b1+b2 is a burst; b3 is a lone frame and drops out (below minSize).
    expect(clusterBursts(assets, hashes, OPTS)).toEqual([{ memberIds: ['b1', 'b2'] }]);
  });

  it('splits when frames are too visually different', () => {
    const assets = [asset('b1', 0), asset('b2', 1), asset('b3', 2)];
    const hashes = new Map([
      ['b1', SAME],
      ['b2', SAME],
      ['b3', FAR],
    ]);

    expect(clusterBursts(assets, hashes, OPTS)).toEqual([{ memberIds: ['b1', 'b2'] }]);
  });

  it('splits across different cameras even when close in time', () => {
    const assets = [asset('b1', 0, 'cam-1'), asset('b2', 1, 'cam-2')];
    const hashes = new Map([
      ['b1', SAME],
      ['b2', SAME],
    ]);

    expect(clusterBursts(assets, hashes, OPTS)).toEqual([]);
  });

  it('falls back to time + camera when hashes are missing', () => {
    const assets = [asset('b1', 0), asset('b2', 1), asset('b3', 2)];

    expect(clusterBursts(assets, new Map(), OPTS)).toEqual([{ memberIds: ['b1', 'b2', 'b3'] }]);
  });

  it('ignores assets without a usable capture time', () => {
    const assets: DetectAsset[] = [
      { id: 'x', taken: '', camera: 'cam-1' },
      asset('b1', 0),
      asset('b2', 1),
    ];
    const hashes = new Map([
      ['b1', SAME],
      ['b2', SAME],
    ]);

    expect(clusterBursts(assets, hashes, OPTS)).toEqual([{ memberIds: ['b1', 'b2'] }]);
  });

  it('returns nothing when no run reaches minSize', () => {
    const assets = [asset('b1', 0), asset('b2', 10)]; // two lone frames, far apart
    const hashes = new Map([
      ['b1', SAME],
      ['b2', SAME],
    ]);

    expect(clusterBursts(assets, hashes, OPTS)).toEqual([]);
  });
});
