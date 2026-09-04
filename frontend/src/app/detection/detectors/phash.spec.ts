import {
  MATCH_SIZE,
  SIGNATURE_SIZE,
  alignedSignatureDistance,
  reduceSignature,
  dhash,
  hammingDistance,
  lumaHammingDistance,
  colorDhash,
  HASH_WIDTH,
  HASH_HEIGHT,
  COLOR_WIDTH,
  COLOR_HEIGHT,
} from './phash';

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

  it('dead-bands shallow gradients with a margin', () => {
    // Each cell is 4 brighter than its right neighbour — a real but shallow step.
    const grid = gridFromRow([32, 28, 24, 20, 16, 12, 8, 4, 0]);
    expect(dhash(grid)).toBe('ffffffffffffffff'); // margin 0 → every step counts
    expect(dhash(grid, HASH_WIDTH, HASH_HEIGHT, 6)).toBe('0000000000000000'); // 4 ≤ 6 → flattened
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

describe('colorDhash', () => {
  const fill = (r: number, g: number, b: number): Uint8ClampedArray => {
    const rgba = new Uint8ClampedArray(COLOR_WIDTH * COLOR_HEIGHT * 4);
    for (let p = 0; p < COLOR_WIDTH * COLOR_HEIGHT; p++) {
      rgba[p * 4] = r;
      rgba[p * 4 + 1] = g;
      rgba[p * 4 + 2] = b;
      rgba[p * 4 + 3] = 255;
    }
    return rgba;
  };

  it('is 8 hex chars — 32 colour bits (two opponent channels)', () => {
    expect(colorDhash(fill(128, 128, 128))).toHaveLength(8);
  });

  it('is all-zero for a flat frame (no colour gradient to compare)', () => {
    expect(colorDhash(fill(200, 50, 50))).toBe('00000000');
  });

  it('is non-zero when colour varies across the frame', () => {
    // Red ramps *down* across columns (g=b=0) → a falling red-green gradient → set bits.
    const rgba = new Uint8ClampedArray(COLOR_WIDTH * COLOR_HEIGHT * 4);
    for (let y = 0; y < COLOR_HEIGHT; y++) {
      for (let x = 0; x < COLOR_WIDTH; x++) {
        const p = y * COLOR_WIDTH + x;
        rgba[p * 4] = (COLOR_WIDTH - 1 - x) * 50;
        rgba[p * 4 + 3] = 255;
      }
    }
    expect(colorDhash(rgba)).not.toBe('00000000');
  });
});

describe('lumaHammingDistance', () => {
  it('ignores the appended colour bits', () => {
    // Identical 16-hex luma, different colour tail → luma distance 0.
    expect(lumaHammingDistance('0000000000000000ffffffff', '0000000000000000aaaaaaaa')).toBe(0);
  });

  it('measures only the luma portion', () => {
    expect(lumaHammingDistance('000000000000000f00000000', '0000000000000000ffffffff')).toBe(4);
  });
});

describe('alignedSignatureDistance', () => {
  /** A signature whose content starts `shift` columns in — one scene, seen from a step aside. */
  function scene(shift: number): Uint8Array {
    const out = new Uint8Array(SIGNATURE_SIZE * SIGNATURE_SIZE);
    for (let y = 0; y < SIGNATURE_SIZE; y++) {
      for (let x = 0; x < SIGNATURE_SIZE; x++) {
        let h = (Math.imul(x + shift, 19349663) ^ Math.imul(y, 83492791)) >>> 0;
        h = Math.imul(h ^ (h >>> 13), 2654435761) >>> 0;
        out[y * SIGNATURE_SIZE + x] = (h ^ (h >>> 16)) & 0xff;
      }
    }
    return out;
  }

  // The reason the whole matcher was rebuilt around this: two eyes of one shot differ by *where the
  // photographers stood*, and a measurement that counts that against them is measuring the wrong
  // thing. Slid back into place, the same scene costs nothing at all.
  it('charges nothing for a shift it can slide out', () => {
    const distance = alignedSignatureDistance(
      reduceSignature(scene(0)),
      reduceSignature(scene(4 * (SIGNATURE_SIZE / MATCH_SIZE))),
    );

    expect(distance).toBe(0);
  });

  it('still separates two different scenes, which no shift brings together', () => {
    const other = new Uint8Array(SIGNATURE_SIZE * SIGNATURE_SIZE);
    for (let i = 0; i < other.length; i++) other[i] = (i * 37) % 256;

    const distance = alignedSignatureDistance(reduceSignature(scene(0)), reduceSignature(other));

    expect(distance).toBeGreaterThan(25); // the matcher's tolerance
  });

  // A shift beyond the search range must not be silently rewarded: the range is what stops the
  // search finding an alignment for two frames that have nothing to do with each other.
  it('does not slide further than it is allowed to', () => {
    const far = alignedSignatureDistance(
      reduceSignature(scene(0)),
      reduceSignature(scene(64)),
      MATCH_SIZE,
      2,
    );

    expect(far).toBeGreaterThan(0);
  });
});
