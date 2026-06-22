import { PanoAsset, PanoOptions, clusterPanos, overlapMatch } from './pano';
import { SIGNATURE_SIZE } from './phash';

const N = SIGNATURE_SIZE;
const asset = (id: string, taken: string): PanoAsset => ({ id, taken });

// A 1-D scene sampled into a signature. A horizontal frame's column c shows scene `startX + c` (with
// row-dependent texture so mean-subtracted lines carry signal); a vertical frame's row r shows scene
// `startY + r`. Frames 32 apart overlap by 32 columns/rows — a clean 50% pan. `sv` is a deterministic
// pseudo-random of (scene position, perpendicular index) — non-periodic, so distant positions don't
// coincidentally match.
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
const vert = (startY: number): Uint8Array => {
  const g = new Uint8Array(N * N);
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) g[r * N + c] = sv(startY + r, c);
  return g;
};

const opts: PanoOptions = {
  windowMs: 60_000,
  minWholeHamming: 0, // distinctness gate off for the overlap-focused tests (no whole hashes given)
  maxSeamScore: 5,
  minOverlap: 0.1,
  maxOverlap: 0.8,
  minSize: 3,
};
const noHashes = new Map<string, string>();

const t = (s: number): string => `2026-05-01T10:00:0${s}Z`;
const run = (): PanoAsset[] => [asset('f1', t(0)), asset('f2', t(1)), asset('f3', t(2))];

describe('clusterPanos', () => {
  it('groups a horizontal run whose frames overlap left↔right, in capture order', () => {
    const sigs = new Map([
      ['f1', horiz(0)],
      ['f2', horiz(32)], // left half === f1's right half
      ['f3', horiz(64)], // left half === f2's right half
    ]);
    expect(clusterPanos(run(), sigs, noHashes, opts)).toEqual([
      { memberIds: ['f1', 'f2', 'f3'], orientation: 'horizontal' },
    ]);
  });

  it('groups a vertical run whose frames overlap top↔bottom', () => {
    const sigs = new Map([
      ['f1', vert(0)],
      ['f2', vert(32)],
      ['f3', vert(64)],
    ]);
    expect(clusterPanos(run(), sigs, noHashes, opts)).toEqual([
      { memberIds: ['f1', 'f2', 'f3'], orientation: 'vertical' },
    ]);
  });

  it('rejects same-scene near-duplicates even though they overlap perfectly', () => {
    const sigs = new Map([
      ['f1', horiz(0)],
      ['f2', horiz(32)],
      ['f3', horiz(64)],
    ]);
    const same = new Map([
      ['f1', '0000000000000000'],
      ['f2', '0000000000000000'], // identical → Hamming 0
      ['f3', '0000000000000000'],
    ]);
    const gated = { ...opts, minWholeHamming: 10 };
    expect(clusterPanos(run(), sigs, same, gated)).toEqual([]);

    const distinct = new Map([
      ['f1', '0000000000000000'],
      ['f2', '00000000ffffffff'], // 32 apart
      ['f3', 'ffffffffffffffff'],
    ]);
    expect(clusterPanos(run(), sigs, distinct, gated)).toEqual([
      { memberIds: ['f1', 'f2', 'f3'], orientation: 'horizontal' },
    ]);
  });

  it('splits the run when the time gap is too large', () => {
    const assets = [asset('f1', t(0)), asset('f2', t(1)), asset('f3', '2026-05-01T11:00:00Z')];
    const sigs = new Map([
      ['f1', horiz(0)],
      ['f2', horiz(32)],
      ['f3', horiz(64)],
    ]);
    // f1–f2 overlap but that's only 2 (< minSize 3); f3 is too far → no pano.
    expect(clusterPanos(assets, sigs, noHashes, opts)).toEqual([]);
  });

  it('breaks a run at a frame missing its signature', () => {
    const sigs = new Map([
      ['f1', horiz(0)],
      // f2 has no signature
      ['f3', horiz(64)],
    ]);
    expect(clusterPanos(run(), sigs, noHashes, opts)).toEqual([]);
  });

  it('does not group frames that do not overlap', () => {
    const sigs = new Map([
      ['f1', horiz(0)],
      ['f2', horiz(300)], // a different part of the scene → no shared content
      ['f3', horiz(600)],
    ]);
    expect(clusterPanos(run(), sigs, noHashes, opts)).toEqual([]);
  });

  it('excludes a frame whose aspect ratio differs too much, even if it overlaps', () => {
    const sigs = new Map([
      ['f1', horiz(0)],
      ['f2', horiz(32)],
      ['f3', horiz(64)],
      ['f4', horiz(96)], // overlaps f3, but it's a wide stitched output, not a portrait source
    ]);
    const portraitRun: PanoAsset[] = [
      { id: 'f1', taken: t(0), aspect: 0.67 },
      { id: 'f2', taken: t(1), aspect: 0.67 },
      { id: 'f3', taken: t(2), aspect: 0.67 },
      { id: 'f4', taken: t(3), aspect: 2.2 }, // ~3× wider → incompatible
    ];
    expect(clusterPanos(portraitRun, sigs, noHashes, opts)).toEqual([
      { memberIds: ['f1', 'f2', 'f3'], orientation: 'horizontal' },
    ]);
  });
});

describe('overlapMatch', () => {
  it('finds the overlap offset, near-zero score and forward direction for a clean pan', () => {
    const m = overlapMatch(horiz(0), horiz(32), 'horizontal', opts);
    expect(m.score).toBeLessThan(1);
    expect(m.overlap).toBeCloseTo(0.5, 1);
    expect(m.forward).toBe(true);
  });

  it('scores unrelated frames far above a real seam', () => {
    const m = overlapMatch(horiz(0), horiz(300), 'horizontal', opts);
    expect(m.score).toBeGreaterThan(5);
  });
});
