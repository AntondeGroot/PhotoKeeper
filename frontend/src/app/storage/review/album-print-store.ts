import { Injectable, inject } from '@angular/core';
import { AlbumPrintState } from '../../prints/prints.types';
import { PhotoKeeperDb } from '../photokeeper-db';

/**
 * Device-local record of each album's print-fulfilment state (album name → ordered/placed), so the
 * Prints tab remembers what's been ordered and what's been placed across reloads. Absent = still "To
 * print"; a 'placed' album is complete and never shown or nudged about again.
 */
@Injectable({ providedIn: 'root' })
export class AlbumPrintStore {
  private readonly db = inject(PhotoKeeperDb);

  /** Album name → its current print state. */
  async getAll(): Promise<Map<string, AlbumPrintState>> {
    const db = await this.db.open();
    const keys = await db.getAllKeys('albumPrint');
    const values = await db.getAll('albumPrint');
    const map = new Map<string, AlbumPrintState>();
    keys.forEach((key, i) => map.set(key, values[i]));
    return map;
  }

  async set(album: string, state: AlbumPrintState): Promise<void> {
    await (await this.db.open()).put('albumPrint', state, album);
  }
}
