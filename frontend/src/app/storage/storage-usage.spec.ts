import { PhotoKeeperSchema } from './photokeeper-db';
import { byteSize, formatBytes, summarise } from './storage-usage';
import { STORAGE_USAGE_GROUPS } from './storage-usage.service';

describe('storage usage', () => {
  describe('byteSize', () => {
    // The two that matter: previews and signatures are nearly all of the space, and both carry their
    // own byte count, so the figure the user sees is exact where it is large.
    it('takes a blob and a typed array at their word', () => {
      expect(byteSize(new Blob(['0123456789']))).toBe(10);
      expect(byteSize(new Uint8Array(4096))).toBe(4096);
    });

    it('estimates an object from what it would serialise to', () => {
      expect(byteSize({ status: 'kept' })).toBe(JSON.stringify({ status: 'kept' }).length);
    });

    it('survives a value that cannot be serialised', () => {
      const circular: Record<string, unknown> = {};
      circular['self'] = circular;

      expect(byteSize(circular)).toBe(0);
    });
  });

  describe('formatBytes', () => {
    it.each([
      { bytes: 0, reads: '0 B' },
      { bytes: 999, reads: '999 B' },
      { bytes: 1000, reads: '1.0 kB' },
      { bytes: 812_000, reads: '812 kB' },
      { bytes: 1_400_000, reads: '1.4 MB' },
      { bytes: 2_500_000_000, reads: '2.5 GB' },
    ])('reads $bytes as $reads', ({ bytes, reads }) => {
      expect(formatBytes(bytes)).toBe(reads);
    });
  });

  describe('summarise', () => {
    it('adds a group up from its stores and leaves empty ones out', () => {
      const usage = summarise(
        STORAGE_USAGE_GROUPS,
        new Map([
          ['verdicts', { bytes: 300, records: 12 }],
          ['tags', { bytes: 100, records: 4 }],
          ['previews', { bytes: 5_000_000, records: 200 }],
        ]),
        null,
        null,
      );

      expect(usage.groups.map((g) => g.group)).toEqual(['work', 'previews']);
      expect(usage.groups[0]).toMatchObject({ bytes: 400, records: 16, rebuildable: false });
      expect(usage.total).toBe(5_000_400);
    });

    it('carries the browser’s own figures through untouched', () => {
      const usage = summarise(STORAGE_USAGE_GROUPS, new Map(), 9_000, 100_000);

      expect(usage.reported).toBe(9_000);
      expect(usage.quota).toBe(100_000);
    });
  });

  // A store added to the schema and forgotten here would simply never be counted, and the total
  // would quietly understate what the app is using — the one failure this screen cannot afford.
  it('accounts for every store the schema declares', () => {
    const schema: Record<keyof PhotoKeeperSchema, true> = {
      previews: true,
      verdicts: true,
      dailyFeed: true,
      albumTags: true,
      assetHash: true,
      albumManifest: true,
      groups: true,
      assetMeta: true,
      groupOverrides: true,
      groupReclass: true,
      groupMembers: true,
      frameSignature: true,
      frameAspect: true,
      tags: true,
      assetTags: true,
      albumPrint: true,
      celebrationLog: true,
      celebrationCurrent: true,
      reviewBuffer: true,
    };
    const grouped = STORAGE_USAGE_GROUPS.flatMap((g) => g.stores);

    const alphabetical = (a: string, b: string) => a.localeCompare(b);
    expect([...grouped].sort(alphabetical)).toEqual(Object.keys(schema).sort(alphabetical));
  });
});
