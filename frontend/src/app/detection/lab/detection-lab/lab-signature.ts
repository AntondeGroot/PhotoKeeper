import { SIGNATURE_SIZE } from '../../detectors/phash';
import { FrameSignature } from '../../detectors/detection-types';

/** Nearest-neighbour zoom when exporting a signature, so the 64×64 grid is actually viewable. */
const SIGNATURE_ZOOM = 4;

/** Renders a grayscale signature grid to a zoomed PNG blob (crisp pixels, no smoothing). */
export async function signatureToPng(signature: FrameSignature): Promise<Blob> {
  const n = SIGNATURE_SIZE;
  const small = new OffscreenCanvas(n, n);
  const sctx = small.getContext('2d');
  if (!sctx) throw new Error('no 2d context');
  const img = sctx.createImageData(n, n);
  for (let p = 0; p < n * n; p++) {
    const v = signature[p];
    img.data[p * 4] = v;
    img.data[p * 4 + 1] = v;
    img.data[p * 4 + 2] = v;
    img.data[p * 4 + 3] = 255;
  }
  sctx.putImageData(img, 0, 0);

  const big = new OffscreenCanvas(n * SIGNATURE_ZOOM, n * SIGNATURE_ZOOM);
  const bctx = big.getContext('2d');
  if (!bctx) throw new Error('no 2d context');
  bctx.imageSmoothingEnabled = false;
  bctx.drawImage(small, 0, 0, big.width, big.height);
  return big.convertToBlob({ type: 'image/png' });
}
