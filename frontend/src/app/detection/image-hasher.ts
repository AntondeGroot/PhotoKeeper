import { Injectable } from '@angular/core';
import { FrameSignature } from '../storage/photokeeper-db';
import { frameSignatureFromBlob, hashImageBlob, imageAspect } from './phash';

/**
 * Thin injectable wrapper around the canvas hashing glue. Exists so the background scan can depend on
 * an abstraction instead of `createImageBitmap` directly, which keeps the orchestrator unit-testable
 * (tests provide a stub hasher; no real image decoding needed).
 */
@Injectable({ providedIn: 'root' })
export class ImageHasher {
  hash(blob: Blob): Promise<string> {
    return hashImageBlob(blob);
  }

  signature(blob: Blob): Promise<FrameSignature> {
    return frameSignatureFromBlob(blob);
  }

  aspect(blob: Blob): Promise<number> {
    return imageAspect(blob);
  }
}
