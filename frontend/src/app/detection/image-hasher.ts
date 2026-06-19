import { Injectable } from '@angular/core';
import { EdgeHash } from '../storage/photokeeper-db';
import { edgeHashImageBlob, hashImageBlob } from './phash';

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

  edgeHash(blob: Blob): Promise<EdgeHash> {
    return edgeHashImageBlob(blob);
  }
}
