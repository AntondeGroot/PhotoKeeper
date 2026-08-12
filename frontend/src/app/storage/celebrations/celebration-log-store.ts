import { Injectable, inject } from '@angular/core';
import { CurrentPick, ShownLog, ShownRecord } from '../../celebrations/celebration.types';
import { PhotoKeeperDb } from '../photokeeper-db';

/** There is only ever one current pick, so it lives under a fixed key. */
const CURRENT_KEY = 'current';

/**
 * Device-local record of which celebration images have been shown: when each was last seen, how
 * often, and which guarantee claims it has spent.
 *
 * Without this the picker has no memory, so "once ever", "once per year" and cooldowns all
 * collapse — every session would look like the first one. Keyed by image id.
 */
@Injectable({ providedIn: 'root' })
export class CelebrationLogStore {
  private readonly db = inject(PhotoKeeperDb);

  /** The whole log. Small — one record per image ever shown — so it loads in one go. */
  async load(): Promise<ShownLog> {
    const db = await this.db.open();
    const keys = await db.getAllKeys('celebrationLog');
    const values = await db.getAll('celebrationLog');

    const log: ShownLog = {};
    keys.forEach((key, i) => (log[key] = values[i]));
    return log;
  }

  /** Writes one image's record. Only the shown image changes, so there's no need to rewrite the log. */
  async put(id: string, record: ShownRecord): Promise<void> {
    await (await this.db.open()).put('celebrationLog', record, id);
  }

  /**
   * The pick standing for the current session, if one was made. Kept alongside the log because it
   * answers the same question — what has already been shown — just for the session in progress
   * rather than for all time.
   */
  async loadCurrent(): Promise<CurrentPick | undefined> {
    return (await this.db.open()).get('celebrationCurrent', CURRENT_KEY);
  }

  async saveCurrent(pick: CurrentPick): Promise<void> {
    await (await this.db.open()).put('celebrationCurrent', pick, CURRENT_KEY);
  }
}
