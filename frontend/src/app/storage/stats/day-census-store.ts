import { Injectable, inject } from '@angular/core';
import { DayCensus } from '../../stats/census';
import { PhotoKeeperDb } from '../photokeeper-db';

/**
 * One row per day, saying what the library looked like that day.
 *
 * The only store here that is a *record* rather than a cache: everything else can be rebuilt by
 * scanning again, and this cannot be rebuilt at all — yesterday is not observable today. So it is
 * kept out of the `STALE_AT` list with the verdicts and the tags, and is never cleared by a version
 * bump.
 */
@Injectable({ providedIn: 'root' })
export class DayCensusStore {
  private readonly db = inject(PhotoKeeperDb);

  async get(day: string): Promise<DayCensus | undefined> {
    return (await this.db.open()).get('dayCensus', day);
  }

  async put(census: DayCensus): Promise<void> {
    await (await this.db.open()).put('dayCensus', census, census.day);
  }

  /** Every day on record, oldest first — the chart's input. */
  async history(): Promise<DayCensus[]> {
    const rows = await (await this.db.open()).getAll('dayCensus');
    return [...rows].sort((a, b) => a.day.localeCompare(b.day));
  }
}
