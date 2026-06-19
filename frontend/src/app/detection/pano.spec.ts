import { EdgeHash, PanoAsset, clusterPanos } from './pano';

const asset = (id: string, taken: string): PanoAsset => ({ id, taken });

// Distinct 64-bit hex hashes; chaining one frame's seam-edge to the next's means they overlap (a pan).
const H = {
  a: '0000000000000000',
  b: '0000000000000001',
  c: 'ffffffffffffffff',
  d: '00000000ffffffff',
};
// A horizontal frame chains on left/right; its top/bottom are pinned far apart so a vertical seam
// can never accidentally match. A vertical frame is the mirror image.
const FAR = 'ffffffffffffffff';
const NEAR = '0000000000000000';
const hedge = (left: string, right: string): EdgeHash => ({ left, right, top: NEAR, bottom: FAR });
const vedge = (top: string, bottom: string): EdgeHash => ({ top, bottom, left: NEAR, right: FAR });

const opts = { windowMs: 60_000, maxEdgeHamming: 4, minSize: 3 };

describe('clusterPanos', () => {
  it('groups a horizontal run whose adjacent left/right edges overlap, in capture order', () => {
    const assets = [
      asset('f1', '2026-05-01T10:00:00Z'),
      asset('f2', '2026-05-01T10:00:01Z'),
      asset('f3', '2026-05-01T10:00:02Z'),
    ];
    const edges = new Map([
      ['f1', hedge(H.a, H.b)],
      ['f2', hedge(H.b, H.c)], // f2.left === f1.right → overlap
      ['f3', hedge(H.c, H.d)], // f3.left === f2.right → overlap
    ]);

    expect(clusterPanos(assets, edges, opts)).toEqual([
      { memberIds: ['f1', 'f2', 'f3'], orientation: 'horizontal' },
    ]);
  });

  it('groups a vertical run whose adjacent top/bottom edges overlap', () => {
    const assets = [
      asset('f1', '2026-05-01T10:00:00Z'),
      asset('f2', '2026-05-01T10:00:01Z'),
      asset('f3', '2026-05-01T10:00:02Z'),
    ];
    const edges = new Map([
      ['f1', vedge(H.a, H.b)],
      ['f2', vedge(H.b, H.c)], // f2.top === f1.bottom → overlap
      ['f3', vedge(H.c, H.d)], // f3.top === f2.bottom → overlap
    ]);

    expect(clusterPanos(assets, edges, opts)).toEqual([
      { memberIds: ['f1', 'f2', 'f3'], orientation: 'vertical' },
    ]);
  });

  it('locks orientation: a vertical-only overlap cannot extend a horizontal run', () => {
    const assets = [
      asset('f1', '2026-05-01T10:00:00Z'),
      asset('f2', '2026-05-01T10:00:01Z'),
      asset('f3', '2026-05-01T10:00:02Z'),
      asset('f4', '2026-05-01T10:00:03Z'),
    ];
    const edges = new Map<string, EdgeHash>([
      ['f1', hedge(H.a, H.b)],
      ['f2', hedge(H.b, H.c)],
      ['f3', hedge(H.c, H.d)], // f1–f3 lock the run horizontal (their bottom edge is FAR)
      // f4 meets f3 only on the vertical seam (its top === f3.bottom), not horizontally.
      ['f4', { left: H.a, right: H.a, top: FAR, bottom: NEAR }],
    ]);

    // The run is locked horizontal, so f4's vertical match is never tested → it breaks the run.
    expect(clusterPanos(assets, edges, opts)).toEqual([
      { memberIds: ['f1', 'f2', 'f3'], orientation: 'horizontal' },
    ]);
  });

  it('does not group frames whose edges do not meet', () => {
    const assets = [
      asset('f1', '2026-05-01T10:00:00Z'),
      asset('f2', '2026-05-01T10:00:01Z'),
      asset('f3', '2026-05-01T10:00:02Z'),
    ];
    const edges = new Map([
      ['f1', hedge(H.a, H.a)],
      ['f2', hedge(H.c, H.c)], // f2.left (c) ≠ f1.right (a)
      ['f3', hedge(H.a, H.a)],
    ]);

    expect(clusterPanos(assets, edges, opts)).toEqual([]);
  });

  it('splits the run when the time gap is too large', () => {
    const assets = [
      asset('f1', '2026-05-01T10:00:00Z'),
      asset('f2', '2026-05-01T10:00:01Z'),
      asset('f3', '2026-05-01T11:00:00Z'), // an hour later
    ];
    const edges = new Map([
      ['f1', hedge(H.a, H.b)],
      ['f2', hedge(H.b, H.c)],
      ['f3', hedge(H.c, H.d)],
    ]);

    // f1–f2 overlap but that's only 2 (< minSize 3); f3 is too far → no pano.
    expect(clusterPanos(assets, edges, opts)).toEqual([]);
  });

  it('breaks a run at a frame missing edge hashes', () => {
    const assets = [
      asset('f1', '2026-05-01T10:00:00Z'),
      asset('f2', '2026-05-01T10:00:01Z'),
      asset('f3', '2026-05-01T10:00:02Z'),
    ];
    const edges = new Map([
      ['f1', hedge(H.a, H.b)],
      // f2 has no edge hash
      ['f3', hedge(H.b, H.c)],
    ]);

    expect(clusterPanos(assets, edges, opts)).toEqual([]);
  });

  it('detects a pan in the other direction (left edge of one meets right edge of the next)', () => {
    const assets = [
      asset('f1', '2026-05-01T10:00:00Z'),
      asset('f2', '2026-05-01T10:00:01Z'),
      asset('f3', '2026-05-01T10:00:02Z'),
    ];
    const edges = new Map([
      ['f1', hedge(H.b, H.a)],
      ['f2', hedge(H.c, H.b)], // f1.left (b) === f2.right (b) → overlap (panning left)
      ['f3', hedge(H.d, H.c)], // f2.left (c) === f3.right (c) → overlap
    ]);

    expect(clusterPanos(assets, edges, opts)).toEqual([
      { memberIds: ['f1', 'f2', 'f3'], orientation: 'horizontal' },
    ]);
  });
});
