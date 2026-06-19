import { Injectable, inject } from '@angular/core';
import { PhotoKeeperDb } from './photokeeper-db';

/**
 * Device-local index of rendition aspect ratios (assetId → width/height), the pano aspect gate's
 * input. Computed alongside the frame signature and just as durable, so re-detecting panos needs no
 * re-decode.
 */
@Injectable({ providedIn: 'root' })
export class AspectStore {
  private readonly db = inject(PhotoKeeperDb);

  async put(assetId: string, aspect: number): Promise<void> {
    await (await this.db.open()).put('frameAspect', aspect, assetId);
  }

  async delete(assetId: string): Promise<void> {
    await (await this.db.open()).delete('frameAspect', assetId);
  }

  /** All stored aspects as an assetId → ratio map, ready to hydrate `PanoAsset`s for `clusterPanos`. */
  async getAll(): Promise<Map<string, number>> {
    const db = await this.db.open();
    const keys = await db.getAllKeys('frameAspect');
    const values = await db.getAll('frameAspect');
    const map = new Map<string, number>();
    keys.forEach((key, i) => map.set(key, values[i]));
    return map;
  }
}
