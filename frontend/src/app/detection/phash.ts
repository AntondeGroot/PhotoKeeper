// Perceptual hashing for near-duplicate / burst detection.
//
// dHash: downscale to a fixed tiny grayscale grid, then for each row compare each pixel to its
// right neighbour — one bit per comparison. The result is a (width-1)*height bit fingerprint where
// a small Hamming distance means "visually almost the same". Because the source is downscaled to
// these fixed dims first, feeding a 256px or a 2048px image yields the same hash, so we always hash
// the smallest source available (see hashImageBlob).

// 9×8 grayscale → 8 comparisons per row × 8 rows = a 64-bit hash (16 hex chars).
export const HASH_WIDTH = 9;
export const HASH_HEIGHT = 8;

/**
 * Computes a dHash from a row-major grayscale grid. Pure and deterministic — the unit-testable core.
 * `gray` must hold `width * height` luminance values (0–255).
 */
export function dhash(gray: readonly number[], width = HASH_WIDTH, height = HASH_HEIGHT): string {
  if (gray.length !== width * height) {
    throw new Error(`expected ${width * height} grayscale values, got ${gray.length}`);
  }
  let bits = '';
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width - 1; col++) {
      const i = row * width + col;
      bits += gray[i] > gray[i + 1] ? '1' : '0';
    }
  }
  return bitsToHex(bits);
}

function bitsToHex(bits: string): string {
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) {
    hex += parseInt(bits.slice(i, i + 4).padEnd(4, '0'), 2).toString(16);
  }
  return hex;
}

// Bits set in each nibble 0x0–0xf, for counting differing bits a nibble at a time.
const NIBBLE_POPCOUNT = Array.from(
  { length: 16 },
  (_, n) => (n & 1) + ((n >> 1) & 1) + ((n >> 2) & 1) + ((n >> 3) & 1),
);

/** Number of differing bits between two equal-length hex hashes. 0 = identical. */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) {
    throw new Error('cannot compare hashes of different lengths');
  }
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    distance += NIBBLE_POPCOUNT[parseInt(a[i], 16) ^ parseInt(b[i], 16)];
  }
  return distance;
}

/**
 * Decodes an image blob and hashes it. Thin browser glue around the pure `dhash`: downscale to the
 * fixed grid on an OffscreenCanvas, convert to luminance, hash. Hashing the smallest rendition the
 * caller has on hand keeps this cheap — the downscale throws the extra resolution away anyway.
 */
export async function hashImageBlob(blob: Blob): Promise<string> {
  const bitmap = await createImageBitmap(blob);
  try {
    return hashRegion(bitmap, 0, 0, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

/** Fraction of the width/height taken as each edge strip when hashing for pano overlap. */
const EDGE_FRACTION = 0.25;

/** Perceptual hashes of an asset's four edge strips, for horizontal *and* vertical pano overlap. */
export interface EdgeHashes {
  left: string;
  right: string;
  top: string;
  bottom: string;
}

/**
 * Hashes an image's four edge strips (for pano detection). A horizontal pan meets at the left/right
 * seam (one frame's right ≈ the next's left); a vertical pan meets at the top/bottom seam. The
 * top/bottom strips are hashed *transposed* so the dHash gradient runs along the vertical (pan) axis,
 * mirroring how the left/right strips fingerprint the horizontal axis. Both sides of a seam use the
 * same transform, so a `top`/`bottom` pair stays comparable with {@link hammingDistance}.
 */
export async function edgeHashImageBlob(blob: Blob): Promise<EdgeHashes> {
  const bitmap = await createImageBitmap(blob);
  try {
    const { width, height } = bitmap;
    const stripW = Math.max(1, Math.round(width * EDGE_FRACTION));
    const stripH = Math.max(1, Math.round(height * EDGE_FRACTION));
    return {
      left: hashRegion(bitmap, 0, 0, stripW, height),
      right: hashRegion(bitmap, width - stripW, 0, stripW, height),
      top: hashRegion(bitmap, 0, 0, width, stripH, true),
      bottom: hashRegion(bitmap, 0, height - stripH, width, stripH, true),
    };
  } finally {
    bitmap.close();
  }
}

/**
 * Downscales a source rectangle [sx,sx+sWidth)×[sy,sy+sHeight) to the hash grid and dHashes it. When
 * `transpose` is set, the grid is transposed before hashing so the dHash compares vertically-adjacent
 * pixels — the right scan direction for a vertical (top/bottom) pano seam.
 */
function hashRegion(
  bitmap: ImageBitmap,
  sx: number,
  sy: number,
  sWidth: number,
  sHeight: number,
  transpose = false,
): string {
  const canvas = new OffscreenCanvas(HASH_WIDTH, HASH_HEIGHT);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('could not get a 2d canvas context for hashing');
  ctx.drawImage(bitmap, sx, sy, sWidth, sHeight, 0, 0, HASH_WIDTH, HASH_HEIGHT);
  const { data } = ctx.getImageData(0, 0, HASH_WIDTH, HASH_HEIGHT);
  const gray: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    gray.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]); // Rec. 601 luma
  }
  if (transpose) {
    return dhash(transposeGrid(gray, HASH_WIDTH, HASH_HEIGHT), HASH_HEIGHT, HASH_WIDTH);
  }
  return dhash(gray);
}

/** Transposes a row-major `width`×`height` grid into a row-major `height`×`width` grid. */
function transposeGrid(gray: readonly number[], width: number, height: number): number[] {
  const out: number[] = [];
  for (let col = 0; col < width; col++) {
    for (let row = 0; row < height; row++) {
      out.push(gray[row * width + col]);
    }
  }
  return out;
}
