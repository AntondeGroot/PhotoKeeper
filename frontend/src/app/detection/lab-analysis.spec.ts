import { analyzeClusters, analyzePanoClusters } from './lab-analysis';
import { DetectAsset } from './burst';
import { PanoAsset, PanoOptions } from './pano';
import { SIGNATURE_SIZE } from './phash';

const asset = (id: string, taken: string): DetectAsset => ({ id, taken });

// 3 tight frames, then a far one. With a 3s window, a1..a3 cluster; a4 is the excluded "after".
const assets: DetectAsset[] = [
  asset('a1', '2026-05-01T10:00:00Z'),
  asset('a2', '2026-05-01T10:00:01Z'),
  asset('a3', '2026-05-01T10:00:02Z'),
  asset('a4', '2026-05-01T10:01:00Z'),
];
const hashes = new Map([
  ['a1', '0000000000000000'],
  ['a2', '0000000000000000'],
  ['a3', '0000000000000001'],
  ['a4', 'ffffffffffffffff'],
]);
const opts = { windowMs: 3000, maxHamming: 10, minSize: 2 };

describe('analyzeClusters', () => {
  it('returns the cluster with its excluded neighbours and their gap + hamming', () => {
    const clusters = analyzeClusters(assets, hashes, opts);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].memberIds).toEqual(['a1', 'a2', 'a3']);
    expect(clusters[0].before).toBeNull(); // a1 is the first frame overall
    expect(clusters[0].after).toEqual({
      id: 'a4',
      gapMs: 58_000, // a4 is 58s after a3
      hamming: 63, // ffff…ffff (64 bits) vs 0000…0001 (1 bit) → 63 differ
    });
  });

  it('reports a null hamming when a neighbour has no cached hash', () => {
    const partial = new Map(hashes);
    partial.delete('a4');

    const after = analyzeClusters(assets, partial, opts)[0].after;
    expect(after?.id).toBe('a4');
    expect(after?.hamming).toBeNull();
  });

  it('reflects threshold changes — a tiny window yields no clusters', () => {
    expect(analyzeClusters(assets, hashes, { windowMs: 500, maxHamming: 10, minSize: 2 })).toEqual(
      [],
    );
  });
});

describe('analyzePanoClusters', () => {
  const N = SIGNATURE_SIZE;
  // Deterministic, non-periodic pseudo-random scene (see pano.spec) so distant positions don't match.
  const sv = (x: number, t: number): number => {
    let h = (Math.imul(x + 1, 374761393) + Math.imul(t + 1, 668265263)) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    return (h ^ (h >>> 16)) & 0xff;
  };
  const horiz = (startX: number): Uint8Array => {
    const g = new Uint8Array(N * N);
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) g[r * N + c] = sv(startX + c, r);
    return g;
  };

  // p1..p3 pan horizontally (each right half overlaps the next left half); p4 is far in time + scene.
  const panoAssets: PanoAsset[] = [
    { id: 'p1', taken: '2026-05-01T10:00:00Z' },
    { id: 'p2', taken: '2026-05-01T10:00:01Z' },
    { id: 'p3', taken: '2026-05-01T10:00:02Z' },
    { id: 'p4', taken: '2026-05-01T10:01:00Z' },
  ];
  const signatures = new Map([
    ['p1', horiz(0)],
    ['p2', horiz(32)],
    ['p3', horiz(64)],
    ['p4', horiz(400)],
  ]);
  // Distinct whole-frame hashes; p4 sits 64 from p3.
  const hashes = new Map<string, string>([
    ['p1', '0000000000000000'],
    ['p2', '00000000ffffffff'],
    ['p3', 'ffffffffffffffff'],
    ['p4', '0000000000000000'],
  ]);
  const opts: PanoOptions = {
    windowMs: 3000,
    minWholeHamming: 0,
    maxSeamScore: 5,
    minOverlap: 0.1,
    maxOverlap: 0.8,
    minSize: 2,
  };

  it('returns the pano with its orientation and the excluded after-neighbour distances', () => {
    const clusters = analyzePanoClusters(panoAssets, signatures, hashes, opts);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].memberIds).toEqual(['p1', 'p2', 'p3']);
    expect(clusters[0].orientation).toBe('horizontal');
    expect(clusters[0].before).toBeNull();
    const after = clusters[0].after;
    expect(after).toMatchObject({ id: 'p4', gapMs: 58_000, wholeHamming: 64 });
    expect(after?.seamScore).toBeGreaterThan(opts.maxSeamScore); // p4 doesn't continue p3
  });

  it('reports a null seam score when a neighbour has no cached signature', () => {
    const partial = new Map(signatures);
    partial.delete('p4');

    const after = analyzePanoClusters(panoAssets, partial, hashes, opts)[0].after;
    expect(after?.id).toBe('p4');
    expect(after?.seamScore).toBeNull();
  });

  it('reflects threshold changes — a tiny window yields no panos', () => {
    expect(analyzePanoClusters(panoAssets, signatures, hashes, { ...opts, windowMs: 500 })).toEqual(
      [],
    );
  });
});
