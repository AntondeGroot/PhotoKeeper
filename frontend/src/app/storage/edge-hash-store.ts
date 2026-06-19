import { Injectable, inject } from '@angular/core';
import { EdgeHash, PhotoKeeperDb } from './photokeeper-db';

/**
 * Device-local index of edge-strip hashes (assetId → {left, right}), the input to pano detection.
 * Tiny and durable, like {@link HashStore}, so re-detecting panos is pure in-memory Hamming math.
 */
@Injectable({ providedIn: 'root' })
export class EdgeHashStore {
  private readonly db = inject(PhotoKeeperDb);

  async put(assetId: string, edge: EdgeHash): Promise<void> {
    await (await this.db.open()).put('edgeHash', edge, assetId);
  }

  async delete(assetId: string): Promise<void> {
    await (await this.db.open()).delete('edgeHash', assetId);
  }

  /** All stored edge hashes as an assetId → EdgeHash map, ready to hand to `clusterPanos`. */
  async getAll(): Promise<Map<string, EdgeHash>> {
    const db = await this.db.open();
    const keys = await db.getAllKeys('edgeHash');
    const values = await db.getAll('edgeHash');
    const map = new Map<string, EdgeHash>();
    keys.forEach((key, i) => map.set(key, values[i]));
    return map;
  }
}
