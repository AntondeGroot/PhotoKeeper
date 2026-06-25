// Perceptual hashing for near-duplicate / burst detection.
//
// dHash: downscale to a fixed tiny grayscale grid, then for each row compare each pixel to its
// right neighbour — one bit per comparison. The result is a (width-1)*height bit fingerprint where
// a small Hamming distance means "visually almost the same". Because the source is downscaled to
// these fixed dims first, feeding a 256px or a 2048px image yields the same hash, so we always hash
// the smallest source available (see hashImageBlob).

import { FrameSignature } from './detection-types';

// 9×8 grayscale → 8 comparisons per row × 8 rows = a 64-bit hash (16 hex chars).
export const HASH_WIDTH = 9;
export const HASH_HEIGHT = 8;

// A small opponent-colour dHash appended after the luma hash, so two frames laid out the same in
// brightness but coloured differently get a different fingerprint. Two linear opponent channels
// (red–green, yellow–blue) at a 5×4 grid → (5-1)*4 = 16 bits each = 32 colour bits (8 hex chars).
export const COLOR_WIDTH = 5;
export const COLOR_HEIGHT = 4;

/**
 * Dead-band for the colour dHash, in opponent-channel units. A plain dHash compares each cell to its
 * neighbour, but where the colour is near-flat (sky, walls, low saturation) that difference is just
 * noise, so the sign flips randomly between otherwise-identical frames and inflates the distance. Only
 * a difference beyond this margin counts as a real colour edge; anything flatter is a stable 0.
 */
const COLOR_MARGIN = 14;

/** Hex chars in the luma portion of a hash — `lumaHammingDistance` compares only these. */
const LUMA_HEX = ((HASH_WIDTH - 1) * HASH_HEIGHT) / 4;

/**
 * Dead-band for the luma dHash, in 0–255 luminance units. The 9×8 grid is coarse, so in low-gradient
 * regions a cell and its neighbour are nearly equal and the comparison sign is noise — flipping bits
 * between otherwise-identical frames and fragmenting real bursts. Only a difference beyond this margin
 * counts as an edge; flatter is a stable 0.
 */
const LUMA_MARGIN = 6;

/**
 * Computes a dHash from a row-major grid. Pure and deterministic — the unit-testable core. `grid` must
 * hold `width * height` values. A bit is set when a cell exceeds its right neighbour by more than
 * `margin`; the margin is a dead-band that turns near-equal (flat, noise-dominated) regions into stable
 * zeros instead of coin-flips — without it, two visually-identical frames pick up spurious distance in
 * low-gradient areas (sky, walls). `margin` 0 is a plain dHash.
 */
export function dhash(
  grid: readonly number[],
  width = HASH_WIDTH,
  height = HASH_HEIGHT,
  margin = 0,
): string {
  if (grid.length !== width * height) {
    throw new Error(`expected ${width * height} values, got ${grid.length}`);
  }
  let bits = '';
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width - 1; col++) {
      const i = row * width + col;
      bits += grid[i] - grid[i + 1] > margin ? '1' : '0';
    }
  }
  return bitsToHex(bits);
}

/**
 * Opponent-colour dHash from a row-major RGBA grid (`width*height` pixels). Builds two *linear* opponent
 * channels — red−green and yellow−blue — and runs the same brighter-than-right-neighbour comparison as
 * the luma dHash on each. Linear opponents (not circular hue) keep the neighbour comparison meaningful.
 * Returned as hex, ready to append after the luma hash.
 */
export function colorDhash(
  rgba: Uint8ClampedArray | Uint8Array | readonly number[],
  width = COLOR_WIDTH,
  height = COLOR_HEIGHT,
): string {
  const redGreen: number[] = [];
  const yellowBlue: number[] = [];
  for (let p = 0; p < width * height; p++) {
    const r = rgba[p * 4];
    const g = rgba[p * 4 + 1];
    const b = rgba[p * 4 + 2];
    redGreen.push(r - g);
    yellowBlue.push((r + g) / 2 - b);
  }
  return (
    dhash(redGreen, width, height, COLOR_MARGIN) + dhash(yellowBlue, width, height, COLOR_MARGIN)
  );
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

/**
 * Hamming distance over only the luma portion of a hash, ignoring any appended colour bits. Burst
 * detection compares the full hash (so colour separates frames), but stereo near-identity and the pano
 * whole-frame gate use this — two different camera bodies render colour slightly differently, and that
 * must not split a stereo pair or trip the pano gate.
 */
export function lumaHammingDistance(a: string, b: string): number {
  return hammingDistance(a.slice(0, LUMA_HEX), b.slice(0, LUMA_HEX));
}

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
    const luma = dhash(
      grayscaleGrid(bitmap, HASH_WIDTH, HASH_HEIGHT),
      HASH_WIDTH,
      HASH_HEIGHT,
      LUMA_MARGIN,
    );
    const color = colorDhash(
      rgbaGrid(bitmap, COLOR_WIDTH, COLOR_HEIGHT),
      COLOR_WIDTH,
      COLOR_HEIGHT,
    );
    return luma + color;
  } finally {
    bitmap.close();
  }
}

/** Downscales the whole bitmap to a `width`×`height` row-major RGBA buffer (for the colour dHash). */
function rgbaGrid(bitmap: ImageBitmap, width: number, height: number): Uint8ClampedArray {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('could not get a 2d canvas context for hashing');
  ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height).data;
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

/**
 * Mean-normalised, ±1-cell shift-tolerant mean-absolute-difference between two 64×64 luma signatures —
 * the burst near-duplicate metric. Mean-subtraction makes it invariant to exposure drift (unlike a raw
 * pixel diff); the small shift search absorbs the handheld framing jitter that inflates an aligned dHash.
 * Lower = more similar (0 = identical structure). Null if either signature is missing.
 */
export function signatureMad(
  a: FrameSignature | undefined,
  b: FrameSignature | undefined,
): number | null {
  if (!a || !b) return null;
  const ma = signatureMean(a);
  const mb = signatureMean(b);
  let best = Infinity;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      best = Math.min(best, shiftedMad(a, b, ma, mb, dx, dy));
    }
  }
  return Math.round(best);
}

/** Mean-subtracted MAD with `b` shifted by (dx, dy), over the cells where both signatures overlap. */
function shiftedMad(
  a: FrameSignature,
  b: FrameSignature,
  ma: number,
  mb: number,
  dx: number,
  dy: number,
): number {
  const n = SIGNATURE_SIZE;
  let sum = 0;
  let count = 0;
  for (let y = Math.max(0, -dy); y < n - Math.max(0, dy); y++) {
    for (let x = Math.max(0, -dx); x < n - Math.max(0, dx); x++) {
      sum += Math.abs(a[y * n + x] - ma - (b[(y + dy) * n + (x + dx)] - mb));
      count++;
    }
  }
  return count ? sum / count : Infinity;
}

function signatureMean(s: FrameSignature): number {
  let sum = 0;
  for (let i = 0; i < s.length; i++) sum += s[i];
  return sum / s.length;
}
