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
 * Decodes a blob to a bitmap, applying EXIF orientation so we hash the image the way it's *displayed*
 * (an `<img>` honours EXIF; `createImageBitmap` doesn't by default). Without this a rotated frame is
 * hashed sideways — harmless for whole-frame burst matching, but it swaps a pano's horizontal and
 * vertical seams, so left/right and top/bottom edges would be mislabelled.
 */
function decode(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob, { imageOrientation: 'from-image' });
}

/**
 * Decodes an image blob and hashes it. Thin browser glue around the pure `dhash`: downscale to the
 * fixed 9×8 grid on an OffscreenCanvas, convert to luminance, hash. Hashing the smallest rendition the
 * caller has on hand keeps this cheap — the downscale throws the extra resolution away anyway.
 */
export async function hashImageBlob(blob: Blob): Promise<string> {
  const bitmap = await decode(blob);
  try {
    return dhash(grayscaleGrid(bitmap, HASH_WIDTH, HASH_HEIGHT));
  } finally {
    bitmap.close();
  }
}

/**
 * Side of a square grayscale signature used for pano seam matching. Bigger than the dHash grid so the
 * sliding overlap search has enough columns/rows to localise where two frames actually meet.
 */
export const SIGNATURE_SIZE = 64;

/**
 * A whole-frame grayscale thumbnail (SIGNATURE_SIZE², row-major, 0–255) used by the pano matcher. Unlike
 * a fixed-edge hash, this lets the matcher *slide* one frame's edge over the next to find the overlap
 * offset, so detection works regardless of how much the frames overlap. EXIF orientation is applied so
 * the grid matches what's displayed. The downscale is done by {@link signatureFromRgba} (pure, so the
 * same math is exercised by tests that decode fixtures without a canvas).
 */
export async function frameSignatureFromBlob(blob: Blob): Promise<Uint8Array> {
  const bitmap = await decode(blob);
  try {
    const { width, height } = bitmap;
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('could not get a 2d canvas context for hashing');
    ctx.drawImage(bitmap, 0, 0);
    return signatureFromRgba(ctx.getImageData(0, 0, width, height).data, width, height);
  } finally {
    bitmap.close();
  }
}

/**
 * Box-downscales a full-resolution RGBA buffer to a SIGNATURE_SIZE² grayscale signature (Rec. 601 luma,
 * row-major). Pure — no canvas — so production (canvas pixels) and tests (decoded-fixture pixels) share
 * one downscale, making the signature reproducible off-browser.
 */
export function signatureFromRgba(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  size = SIGNATURE_SIZE,
): Uint8Array {
  const out = new Uint8Array(size * size);
  for (let oy = 0; oy < size; oy++) {
    const y0 = Math.floor((oy * height) / size);
    const y1 = Math.max(y0 + 1, Math.floor(((oy + 1) * height) / size));
    for (let ox = 0; ox < size; ox++) {
      const x0 = Math.floor((ox * width) / size);
      const x1 = Math.max(x0 + 1, Math.floor(((ox + 1) * width) / size));
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 4;
          sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; // Rec. 601 luma
          count++;
        }
      }
      out[oy * size + ox] = (sum / count) | 0;
    }
  }
  return out;
}

/** The width/height ratio of an image (EXIF orientation applied), for the pano aspect gate. */
export async function imageAspect(blob: Blob): Promise<number> {
  const bitmap = await decode(blob);
  try {
    return bitmap.height > 0 ? bitmap.width / bitmap.height : 1;
  } finally {
    bitmap.close();
  }
}

/** Downscales the whole bitmap to a `width`×`height` row-major grayscale grid (Rec. 601 luma). */
function grayscaleGrid(bitmap: ImageBitmap, width: number, height: number): number[] {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('could not get a 2d canvas context for hashing');
  ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  const gray: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    gray.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]); // Rec. 601 luma
  }
  return gray;
}
