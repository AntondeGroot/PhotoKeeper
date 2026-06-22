import { Injectable, inject } from '@angular/core';
import { PhotoKeeperDb } from '../photokeeper-db';
import { DetectedGroup } from '../../detection/detectors/detection-types';

/** Stable, idempotent key for a group: its album plus its first member, so a re-scan overwrites. */
function groupId(group: DetectedGroup): string {
  return `${group.sourceAlbumId}:${group.memberIds[0]}`;
}

/**
 * Device-local store of detected groups (groupId → group). The detection scan writes an album's
 * groups here via {@link replaceForAlbum}; group-aware selection reads them back to form review units.
 */
@Injectable({ providedIn: 'root' })
export class GroupStore {
  private readonly db = inject(PhotoKeeperDb);

  async getAll(): Promise<DetectedGroup[]> {
    return (await this.db.open()).getAll('groups');
  }

  /** Every group detected in one album. */
  async getByAlbum(albumId: string): Promise<DetectedGroup[]> {
    const all = await this.getAll();
    return all.filter((g) => g.sourceAlbumId === albumId);
  }

  /**
   * Replaces all of an album's stored groups with `groups` in a single transaction, so a re-scan
   * never leaves stale clusters behind (e.g. a burst that no longer exists after deletions).
   */
  async replaceForAlbum(albumId: string, groups: readonly DetectedGroup[]): Promise<void> {
    const db = await this.db.open();
    const tx = db.transaction('groups', 'readwrite');
    let cursor = await tx.store.openCursor();
    while (cursor) {
      if (cursor.value.sourceAlbumId === albumId) await cursor.delete();
      cursor = await cursor.continue();
    }
    for (const group of groups) await tx.store.put(group, groupId(group));
    await tx.done;
  }
}
