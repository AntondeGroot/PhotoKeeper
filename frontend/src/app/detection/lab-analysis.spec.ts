import { analyzeClusters } from './lab-analysis';
import { DetectAsset } from './burst';

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
