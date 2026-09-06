import { Injectable, inject } from '@angular/core';
import { AlbumPrintState, normalisePrintState } from '../../prints/prints.types';
import { PhotoKeeperDb } from '../photokeeper-db';

/**
 * Device-local record of each album's print-fulfilment state (album name → ordered/received), so the
 * Prints tab remembers where each album is in the journey across reloads. Absent = not ordered yet.
 * Read back through {@link normalisePrintState}, which speaks the older vocabulary too.
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
    keys.forEach((key, i) => map.set(key, normalisePrintState(values[i])));
    return map;
  }

  async set(album: string, state: AlbumPrintState): Promise<void> {
    await (await this.db.open()).put('albumPrint', state, album);
  }
}
