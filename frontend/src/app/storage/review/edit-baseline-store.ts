import { Injectable, inject } from '@angular/core';
import { EditBaseline } from '../../review/edit-detection';
import { PhotoKeeperDb } from '../photokeeper-db';

/**
 * What each photo in the edit queue looked like when it was sent there.
 *
 * The record against which "has this been edited?" is asked. It exists as its own store rather than
 * reusing `assetHash` and the album manifests it is copied from, because those belong to detection
 * and are rewritten by every re-scan — a scan that happened to run after an edit would move the
 * baseline onto the edited photo and the edit would become invisible.
 *
 * Re-baselining is the same write: "not happy with that edit, I'll go back to it" is recorded by
 * storing what the photo looks like *now*, so the next change is found the same way.
 */
@Injectable({ providedIn: 'root' })
export class EditBaselineStore {
  private readonly db = inject(PhotoKeeperDb);

  async get(assetId: string): Promise<EditBaseline | undefined> {
    return (await this.db.open()).get('editBaseline', assetId);
  }

  async getAll(): Promise<Map<string, EditBaseline>> {
    const db = await this.db.open();
    const keys = await db.getAllKeys('editBaseline');
    const values = await db.getAll('editBaseline');
    const map = new Map<string, EditBaseline>();
    keys.forEach((key, i) => map.set(key, values[i]));
    return map;
  }

  async set(assetId: string, baseline: EditBaseline): Promise<void> {
    await (await this.db.open()).put('editBaseline', baseline, assetId);
  }

  /** Forgets a photo's baseline — it has left the edit queue, so there is nothing to compare to. */
  async remove(assetId: string): Promise<void> {
    await (await this.db.open()).delete('editBaseline', assetId);
  }
}
