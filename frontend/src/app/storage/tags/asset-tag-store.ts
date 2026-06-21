import { Injectable, inject } from '@angular/core';
import { PhotoKeeperDb } from '../photokeeper-db';

/**
 * Per-photo tag assignments for the Tag review step: `assetId → tagId[]`. Separate from the {@link
 * TagStore} catalog (the vocabulary) — this is which tags are applied to which photos. An empty set is
 * stored as a deletion so the table only holds tagged photos.
 */
@Injectable({ providedIn: 'root' })
export class AssetTagStore {
  private readonly db = inject(PhotoKeeperDb);

  /** The tag ids applied to one photo (empty array if none). */
  async get(assetId: string): Promise<string[]> {
    return (await (await this.db.open()).get('assetTags', assetId)) ?? [];
  }

  /** Sets a photo's tag ids, removing the row entirely when the set becomes empty. */
  async set(assetId: string, tagIds: string[]): Promise<void> {
    const db = await this.db.open();
    if (tagIds.length === 0) await db.delete('assetTags', assetId);
    else await db.put('assetTags', tagIds, assetId);
  }

  /** Every assignment as `assetId → tagId[]`, for loading the whole map at once. */
  async getAll(): Promise<Record<string, string[]>> {
    const db = await this.db.open();
    const keys = await db.getAllKeys('assetTags');
    const values = await db.getAll('assetTags');
    const map: Record<string, string[]> = {};
    keys.forEach((key, i) => (map[key] = values[i]));
    return map;
  }
}
