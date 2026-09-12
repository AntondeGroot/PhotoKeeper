import { Injectable, inject } from '@angular/core';
import { DayCensus, emptyCensus } from './census';
import { isUnitId } from '../photo';
import { DayService } from '../review/day.service';
import { AssetMetaStore } from '../storage/review/asset-meta-store';
import { DayCensusStore } from '../storage/stats/day-census-store';
import { DeletionLogStore } from '../storage/stats/deletion-log-store';
import { ReviewStore } from '../storage/review/review-store';

/**
 * Writes down what the library looks like today, so progress can be drawn over time.
 *
 * <p>The counts themselves are cheap and always available — two reads of data the app holds anyway —
 * so the device side is taken on every launch. Today's row is overwritten as the day goes on, which
 * makes it settle on the last state of the day rather than the first: a day's work should show as
 * the day it was done.
 *
 * <p>The Lightroom side costs a listing per album, so it is never fetched for this. It is merged in
 * when something else has just looked — see {@link recordAlbum} — and keeps the time it was looked
 * at, because the albums are read at different moments and a stale count should not pass for a
 * fresh one.
 */
@Injectable({ providedIn: 'root' })
export class CensusService {
  private readonly meta = inject(AssetMetaStore);
  private readonly reviews = inject(ReviewStore);
  private readonly store = inject(DayCensusStore);
  private readonly deletions = inject(DeletionLogStore);
  private readonly day = inject(DayService);

  /** Counts the library and the verdicts, and writes them into today's row. */
  async recordToday(): Promise<DayCensus> {
    const [meta, verdicts] = await Promise.all([this.meta.getAll(), this.reviews.getVerdicts()]);
    const census = emptyCensus(this.day.today(), Date.now());
    census.known = meta.size;

    for (const [assetId, verdict] of verdicts) {
      // Unit ids — a burst's card, a panorama's — are not photographs, and counting them would say
      // the library holds more than it does. The photographs they stand for carry their own verdicts.
      if (isUnitId(assetId)) continue;
      census.verdicts[verdict.status] = (census.verdicts[verdict.status] ?? 0) + 1;
      if (!meta.has(assetId)) census.gone++;
    }

    // Everything the scan has seen and nobody has ruled on yet. Counted rather than stored per photo,
    // so it stays right as the library grows.
    const decided = [...verdicts.keys()].filter((id) => !isUnitId(id) && meta.has(id)).length;
    census.verdicts.backlog = Math.max(0, meta.size - decided);
    census.deletedEver = await this.deletions.count();

    return this.merge(census);
  }

  /**
   * Records what one Keeper album holds, when something has just listed it.
   *
   * The deleted photographs are given by id rather than as a number, because they are written into a
   * ledger as well as counted: a tombstone is purged after thirty days, so the album's own count is
   * a rolling window and only the ledger can say how much has been deleted in all.
   */
  async recordAlbum(album: string, held: AlbumContents): Promise<void> {
    const day = this.day.today();
    await this.deletions.noteAll(held.deletedIds, album, day);

    const today = await this.today();
    await this.store.put({
      ...today,
      deletedEver: await this.deletions.count(),
      albums: {
        ...today.albums,
        [album]: { live: held.live, deleted: held.deletedIds.length, at: Date.now() },
      },
    });
  }

  /** Every day on record, oldest first. */
  history(): Promise<DayCensus[]> {
    return this.store.history();
  }

  /** Today's row as it stands, or an empty one for a day nothing has been written for yet. */
  private async today(): Promise<DayCensus> {
    const day = this.day.today();
    return (await this.store.get(day)) ?? emptyCensus(day, Date.now());
  }

  /** Writes the fresh counts over today's row, keeping the album counts already in it. */
  private async merge(census: DayCensus): Promise<DayCensus> {
    const stored = await this.store.get(census.day);
    const merged = stored?.albums ? { ...census, albums: stored.albums } : census;
    await this.store.put(merged);
    return merged;
  }
}

/** What a listing of one Keeper album came back with. */
export interface AlbumContents {
  /** Photographs in it. */
  live: number;
  /** The ids of the photographs whose place a tombstone has taken — the ones Lightroom deleted. */
  deletedIds: readonly string[];
}
