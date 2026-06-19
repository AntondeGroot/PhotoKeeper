import { Injectable, inject } from '@angular/core';
import { FrameSignature, PhotoKeeperDb } from './photokeeper-db';

/**
 * Device-local index of frame signatures (assetId → grayscale grid), the input to pano detection.
 * Small and durable like {@link HashStore}, so re-detecting panos is pure in-memory slide-matching.
 */
@Injectable({ providedIn: 'root' })
export class SignatureStore {
  private readonly db = inject(PhotoKeeperDb);

  async put(assetId: string, signature: FrameSignature): Promise<void> {
    await (await this.db.open()).put('frameSignature', signature, assetId);
  }

  async delete(assetId: string): Promise<void> {
    await (await this.db.open()).delete('frameSignature', assetId);
  }

  /** All stored signatures as an assetId → grid map, ready to hand to `clusterPanos`. */
  async getAll(): Promise<Map<string, FrameSignature>> {
    const db = await this.db.open();
    const keys = await db.getAllKeys('frameSignature');
    const values = await db.getAll('frameSignature');
    const map = new Map<string, FrameSignature>();
    keys.forEach((key, i) => map.set(key, values[i]));
    return map;
  }
}
