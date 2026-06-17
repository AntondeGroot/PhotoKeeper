import { Injectable, inject } from '@angular/core';
import { PhotoKeeperDb } from './photokeeper-db';

/**
 * Device-local index of perceptual hashes (assetId → hex hash). Tiny (~16 bytes/asset) and durable,
 * so detection re-runs are pure in-memory Hamming math with no re-hashing of pixels.
 */
@Injectable({ providedIn: 'root' })
export class HashStore {
  private readonly db = inject(PhotoKeeperDb);

  async get(assetId: string): Promise<string | undefined> {
    return (await this.db.open()).get('assetHash', assetId);
  }

  async put(assetId: string, hash: string): Promise<void> {
    await (await this.db.open()).put('assetHash', hash, assetId);
  }

  /** All stored hashes as an assetId → hash map, ready to hand to the detectors. */
  async getAll(): Promise<Map<string, string>> {
    const db = await this.db.open();
    const keys = await db.getAllKeys('assetHash');
    const values = await db.getAll('assetHash');
    const map = new Map<string, string>();
    keys.forEach((key, i) => map.set(key, values[i]));
    return map;
  }

  async delete(assetId: string): Promise<void> {
    await (await this.db.open()).delete('assetHash', assetId);
  }
}
