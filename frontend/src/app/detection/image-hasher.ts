import { Injectable } from '@angular/core';
import { hashImageBlob } from './phash';

/**
 * Thin injectable wrapper around {@link hashImageBlob}. Exists so the background scan can depend on an
 * abstraction instead of the canvas/`createImageBitmap` glue directly, which keeps the orchestrator
 * unit-testable (tests provide a stub hasher; no real image decoding needed).
 */
@Injectable({ providedIn: 'root' })
export class ImageHasher {
  hash(blob: Blob): Promise<string> {
    return hashImageBlob(blob);
  }
}
