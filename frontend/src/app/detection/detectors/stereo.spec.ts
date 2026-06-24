import { clusterStereo, StereoAsset, StereoOptions, haversineMeters } from './stereo';

const OPTS: StereoOptions = { maxHamming: 10, maxMeters: 25, minSize: 2 };

const SAME = 'aaaaaaaaaaaaaaaa'; // identical hashes → Hamming distance 0
const NEAR = 'aaaaaaaaaaaaaaab'; // vs SAME: distance 2 → within maxHamming (a baseline's small parallax)
const FAR = '0000000000000000'; // vs SAME: distance 32 → a different scene

const BASE_LAT = 52.084259;
const BASE_LNG = 5.130363;
const M_PER_DEG_LAT = 111_320; // ≈ metres per degree of latitude

/** A frame `metersNorth` of the base point (latitude offset only, so separation ≈ |Δ metres|). */
function asset(id: string, metersNorth: number, hash?: string): { a: StereoAsset; hash?: string } {
  return { a: { id, lat: BASE_LAT + metersNorth / M_PER_DEG_LAT, lng: BASE_LNG }, hash };
}

/** Builds the asset list + hash map from `asset()` entries, omitting undefined hashes. */
function build(...entries: { a: StereoAsset; hash?: string }[]): {
  assets: StereoAsset[];
  hashes: Map<string, string>;
} {
  const assets = entries.map((e) => e.a);
  const hashes = new Map<string, string>();
  for (const e of entries) if (e.hash !== undefined) hashes.set(e.a.id, e.hash);
  return { assets, hashes };
}

describe('clusterStereo', () => {
  it('groups near-identical frames at nearby positions into one set', () => {
    // Left position (2 shots) + a 10 m baseline (2 shots) — all the same scene, all within range.
    const { assets, hashes } = build(
      asset('s1', 0, SAME),
      asset('s2', 0, SAME),
      asset('s3', 10, NEAR),
      asset('s4', 10, NEAR),
    );
    expect(clusterStereo(assets, hashes, OPTS)).toEqual([{ memberIds: ['s1', 's2', 's3', 's4'] }]);
  });

  it('clusters by near-identity, not time — input order is preserved, no sorting', () => {
    const { assets, hashes } = build(
      asset('s3', 10, NEAR),
      asset('s1', 0, SAME),
      asset('s2', 0, SAME),
    );
    expect(clusterStereo(assets, hashes, OPTS)).toEqual([{ memberIds: ['s3', 's1', 's2'] }]);
  });

  it('GPS guard splits two identical-looking scenes shot far apart', () => {
    // Same hash everywhere, but the second pair is 1 km away — a different scene that happens to look alike.
    const { assets, hashes } = build(
      asset('near1', 0, SAME),
      asset('near2', 0, SAME),
      asset('far1', 1000, SAME),
      asset('far2', 1000, SAME),
    );
    expect(clusterStereo(assets, hashes, OPTS)).toEqual([
      { memberIds: ['near1', 'near2'] },
      { memberIds: ['far1', 'far2'] },
    ]);
  });

  it('splits a visually different scene at the same spot', () => {
    const { assets, hashes } = build(
      asset('s1', 0, SAME),
      asset('s2', 0, SAME),
      asset('x1', 0, FAR),
      asset('x2', 0, FAR),
    );
    expect(clusterStereo(assets, hashes, OPTS)).toEqual([
      { memberIds: ['s1', 's2'] },
      { memberIds: ['x1', 'x2'] },
    ]);
  });

  it('chains positions within range via single linkage (left → 10 m → 20 m)', () => {
    // 0↔20 is 20 m apart (within 25), but even a tighter guard would chain them through the 10 m frame.
    const { assets, hashes } = build(
      asset('a', 0, SAME),
      asset('b', 10, NEAR),
      asset('c', 20, NEAR),
    );
    expect(clusterStereo(assets, hashes, OPTS)).toEqual([{ memberIds: ['a', 'b', 'c'] }]);
  });

  it('falls back to phash-only when frames carry no GPS (handheld)', () => {
    const assets: StereoAsset[] = [{ id: 'h1' }, { id: 'h2' }, { id: 'h3' }];
    const hashes = new Map([
      ['h1', SAME],
      ['h2', NEAR],
      ['h3', FAR], // a different scene → not part of the set
    ]);
    expect(clusterStereo(assets, hashes, OPTS)).toEqual([{ memberIds: ['h1', 'h2'] }]);
  });

  it('groups on GPS alone when a frame is not yet hashed (does not block)', () => {
    const { assets, hashes } = build(asset('s1', 0, SAME), asset('s2', 5)); // s2 unhashed but 5 m away
    expect(clusterStereo(assets, hashes, OPTS)).toEqual([{ memberIds: ['s1', 's2'] }]);
  });

  it('drops a lone frame below minSize', () => {
    const { assets, hashes } = build(
      asset('s1', 0, SAME),
      asset('s2', 0, SAME),
      asset('lone', 1000, FAR),
    );
    expect(clusterStereo(assets, hashes, OPTS)).toEqual([{ memberIds: ['s1', 's2'] }]);
  });

  it('returns nothing for an empty album', () => {
    expect(clusterStereo([], new Map(), OPTS)).toEqual([]);
  });
});

describe('haversineMeters', () => {
  it('measures a latitude offset back to its metre separation', () => {
    const d = haversineMeters(BASE_LAT, BASE_LNG, BASE_LAT + 10 / M_PER_DEG_LAT, BASE_LNG);
    expect(d).toBeGreaterThan(9);
    expect(d).toBeLessThan(11);
  });

  it('is zero for the same point', () => {
    expect(haversineMeters(BASE_LAT, BASE_LNG, BASE_LAT, BASE_LNG)).toBe(0);
  });
});
