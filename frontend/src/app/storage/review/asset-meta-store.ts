import { Injectable, inject } from '@angular/core';
import { AssetMeta, PhotoKeeperDb } from '../photokeeper-db';

/**
 * Device-local index of lightweight asset metadata (assetId → {@link AssetMeta}). Written by the
 * background detection scan so group-aware selection can hydrate review units straight from
 * IndexedDB, with no foreground re-fetch of album asset lists.
 */
@Injectable({ providedIn: 'root' })
export class AssetMetaStore {
  private readonly db = inject(PhotoKeeperDb);

  async get(assetId: string): Promise<AssetMeta | undefined> {
    return (await this.db.open()).get('assetMeta', assetId);
  }

  async put(assetId: string, meta: AssetMeta): Promise<void> {
    await (await this.db.open()).put('assetMeta', meta, assetId);
  }

  async delete(assetId: string): Promise<void> {
    await (await this.db.open()).delete('assetMeta', assetId);
  }

  /** All stored metadata as an assetId → meta map, ready for the selection assembler. */
  async getAll(): Promise<Map<string, AssetMeta>> {
    const db = await this.db.open();
    const keys = await db.getAllKeys('assetMeta');
    const values = await db.getAll('assetMeta');
    const map = new Map<string, AssetMeta>();
    keys.forEach((key, i) => map.set(key, values[i]));
    return map;
  }
}
