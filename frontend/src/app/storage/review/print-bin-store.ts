import { Injectable, inject } from '@angular/core';
import { PrintBin } from '../../prints/prints.types';
import { PhotoKeeperDb } from '../photokeeper-db';

/**
 * Which print bin holds which album's order.
 *
 * Device-local because Lightroom cannot answer it: the bin album has photos in it, but nothing in
 * the catalogue records *which order* they were, and the API cannot empty the album to make room
 * either. So the app remembers what it sent where, and a bin is freed by the user clearing it in
 * Lightroom and saying so — see {@link free}.
 */
@Injectable({ providedIn: 'root' })
export class PrintBinStore {
  private readonly db = inject(PhotoKeeperDb);

  /** Bin album name → the order sitting in it. Absent means the bin is empty. */
  async getAll(): Promise<Map<string, PrintBin>> {
    const db = await this.db.open();
    const keys = await db.getAllKeys('printBins');
    const values = await db.getAll('printBins');
    const map = new Map<string, PrintBin>();
    keys.forEach((key, i) => map.set(key, values[i]));
    return map;
  }

  async occupy(bin: string, contents: PrintBin): Promise<void> {
    await (await this.db.open()).put('printBins', contents, bin);
  }

  /** The user has emptied the album in Lightroom; the bin can take the next order. */
  async free(bin: string): Promise<void> {
    await (await this.db.open()).delete('printBins', bin);
  }
}
