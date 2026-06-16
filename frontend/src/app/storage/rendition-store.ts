import { Injectable, inject } from '@angular/core';
import { PhotoKeeperDb } from './photokeeper-db';

/** Durable, device-local cache of rendition image blobs (keyed by asset id + size). */
@Injectable({ providedIn: 'root' })
export class RenditionStore {
  private readonly db = inject(PhotoKeeperDb);

  private static key(assetId: string, size: string): string {
    return `${assetId}:${size}`;
  }

  async get(assetId: string, size: string): Promise<Blob | undefined> {
    return (await this.db.open()).get('renditions', RenditionStore.key(assetId, size));
  }

  async put(assetId: string, size: string, blob: Blob): Promise<void> {
    await (await this.db.open()).put('renditions', blob, RenditionStore.key(assetId, size));
  }

  /** Drops every cached rendition whose asset id is not in keepAssetIds. */
  async evictExcept(keepAssetIds: Set<string>): Promise<void> {
    const db = await this.db.open();
    const tx = db.transaction('renditions', 'readwrite');
    let cursor = await tx.store.openCursor();
    while (cursor) {
      const assetId = cursor.key.split(':')[0];
      if (!keepAssetIds.has(assetId)) {
        await cursor.delete();
      }
      cursor = await cursor.continue();
    }
    await tx.done;
  }
}
