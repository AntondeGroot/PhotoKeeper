import { dhash, hammingDistance, HASH_WIDTH, HASH_HEIGHT } from './phash';

// A 9×8 grid built by repeating one 9-pixel row 8 times.
function gridFromRow(row: number[]): number[] {
  return Array.from({ length: HASH_HEIGHT }, () => row).flat();
}

describe('dhash', () => {
  it('is all zeros when every row increases left-to-right', () => {
    // Each comparison (left > right) is false → every bit 0.
    const grid = gridFromRow([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(dhash(grid)).toBe('0000000000000000');
  });

  it('is all ones when every row decreases left-to-right', () => {
    const grid = gridFromRow([8, 7, 6, 5, 4, 3, 2, 1, 0]);
    expect(dhash(grid)).toBe('ffffffffffffffff');
  });

  it('packs bits into hex most-significant-first', () => {
    // Row → bits 1000 0000 (only the first comparison is true) → 0x80 per row.
    const grid = gridFromRow([9, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(dhash(grid)).toBe('8080808080808080');
  });

  it('rejects a grid of the wrong size', () => {
    expect(() => dhash([1, 2, 3], HASH_WIDTH, HASH_HEIGHT)).toThrow();
  });

  it('gives a small Hamming distance to a slightly perturbed image', () => {
    const a = dhash(gridFromRow([0, 1, 2, 3, 4, 5, 6, 7, 8]));
    // Flip a single comparison in one row (4 vs 5 → 5 vs 4) by bumping one pixel.
    const perturbed = gridFromRow([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    perturbed[4] = 99; // now position 3>4? no — 3<99 still false; 99>5 true: flips one bit in row 0
    const b = dhash(perturbed);
    expect(hammingDistance(a, b)).toBeLessThanOrEqual(2);
  });
});

describe('hammingDistance', () => {
  it('is zero for identical hashes', () => {
    expect(hammingDistance('a1b2c3d4e5f60718', 'a1b2c3d4e5f60718')).toBe(0);
  });

  it('counts every differing bit', () => {
    expect(hammingDistance('0000000000000000', 'ffffffffffffffff')).toBe(64);
  });

  it('counts bits within a single nibble', () => {
    expect(hammingDistance('0000000000000000', '000000000000000f')).toBe(4);
    expect(hammingDistance('0000000000000000', '0000000000000001')).toBe(1);
  });

  it('throws on length mismatch', () => {
    expect(() => hammingDistance('ff', 'ffff')).toThrow();
  });
});
