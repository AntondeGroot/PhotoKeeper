import { Injectable, inject, signal } from '@angular/core';
import { StoreNames } from 'idb';
import { PhotoKeeperDb, PhotoKeeperSchema } from './photokeeper-db';
import { StorageUsage, UsageGroupSpec, byteSize, summarise } from './storage-usage';

/**
 * Every store the schema declares — what a usage group is allowed to name.
 *
 * Taken from idb's own helper rather than `keyof PhotoKeeperSchema`, which collapses to `string`:
 * `DBSchema` carries an index signature, so a plain `keyof` would accept any name at all and the
 * grouping below could quietly list a store that does not exist.
 */
type StoreName = StoreNames<PhotoKeeperSchema>;

interface TypedGroupSpec extends UsageGroupSpec {
  stores: readonly StoreName[];
}

/**
 * Which store belongs in which group, and how each is described.
 *
 * The stores divide on one question, the same one the schema's own upgrade rules turn on (see
 * STALE_AT in photokeeper-db): could this be rebuilt if it were lost? Everything derived from the
 * catalogue can be, at the cost of a re-scan and some downloading, while the verdicts, tags and
 * print state are the record of somebody's work and exist nowhere else. Ordered so that the number
 * which looks alarming is also the number that is safe to lose.
 */
const USAGE_GROUPS: TypedGroupSpec[] = [
  {
    group: 'work',
    title: 'Your decisions',
    detail: 'Verdicts, tags, album marks, print orders, and what has reached Lightroom.',
    rebuildable: false,
    stores: [
      'verdicts',
      'tags',
      'assetTags',
      'albumPrint',
      'printBins',
      'keeperFiling',
      'albumTags',
      'groupOverrides',
      'groupReclass',
      'groupMembers',
    ],
  },
  {
    group: 'previews',
    title: 'Cached photos',
    detail: 'Preview images cached, so a session opens without waiting.',
    rebuildable: true,
    stores: ['previews'],
  },
  {
    group: 'detection',
    title: 'Photo fingerprints',
    detail:
      'Small summaries of each photo, used to spot bursts, panoramas and stereo pairs. ' +
      'Rebuilt by scanning again.',
    rebuildable: true,
    stores: ['assetHash', 'frameSignature', 'frameAspect', 'albumManifest', 'groups', 'assetMeta'],
  },
  {
    group: 'queue',
    title: 'Queued up',
    detail: 'Photos chosen ahead of being needed, and today\u2019s deck. Re-sampled freely.',
    rebuildable: true,
    stores: ['reviewBuffer', 'dailyFeed', 'celebrationLog', 'celebrationCurrent'],
  },
];

/** The groups, for anything that needs to know what is measured (the spec asserts completeness). */
export const STORAGE_USAGE_GROUPS: readonly TypedGroupSpec[] = USAGE_GROUPS;

/**
 * How much of the device the app is using, per kind of thing it keeps.
 *
 * Measured rather than estimated from counts: the sizes differ by four orders of magnitude between
 * a verdict and a preview image, so an average would say nothing. Every store is walked with a
 * cursor, which reads one record at a time instead of materialising a whole store — the previews
 * alone can run to hundreds of megabytes, and asking for them all at once to find out how big they
 * are would be a fine way to run the device out of memory doing it.
 *
 * `navigator.storage.estimate()` is reported alongside, because it is the only figure that includes
 * what the engine spends on indexes and overhead. It covers the whole origin rather than this
 * database, so it is shown as its own line rather than folded into the breakdown.
 */
@Injectable({ providedIn: 'root' })
export class StorageUsageService {
  private readonly db = inject(PhotoKeeperDb);

  readonly usage = signal<StorageUsage | null>(null);
  readonly measuring = signal(false);
  readonly failed = signal(false);

  /** Walks every store and publishes the breakdown. Safe to call again; the last result stands. */
  async measure(): Promise<void> {
    if (this.measuring()) return;
    this.measuring.set(true);
    this.failed.set(false);
    try {
      const perStore = await this.measureStores();
      const { usage, quota } = await this.reportedByBrowser();
      this.usage.set(summarise(USAGE_GROUPS, perStore, usage, quota));
    } catch {
      // A blocked or unavailable database costs the report, nothing else.
      this.failed.set(true);
    } finally {
      this.measuring.set(false);
    }
  }

  private async measureStores(): Promise<Map<string, { bytes: number; records: number }>> {
    const db = await this.db.open();
    const perStore = new Map<string, { bytes: number; records: number }>();
    for (const store of USAGE_GROUPS.flatMap((g) => g.stores)) {
      if (!db.objectStoreNames.contains(store)) continue; // a store this build no longer creates
      perStore.set(store, await this.measureStore(db, store));
    }
    return perStore;
  }

  private async measureStore(
    db: Awaited<ReturnType<PhotoKeeperDb['open']>>,
    store: StoreName,
  ): Promise<{ bytes: number; records: number }> {
    const tx = db.transaction(store, 'readonly');
    let cursor = await tx.store.openCursor();
    let bytes = 0;
    let records = 0;
    while (cursor) {
      bytes += byteSize(cursor.value) + String(cursor.key).length;
      records++;
      cursor = await cursor.continue();
    }
    await tx.done;
    return { bytes, records };
  }

  /** What the browser says the origin uses in total, when it is willing to say. */
  private async reportedByBrowser(): Promise<{ usage: number | null; quota: number | null }> {
    try {
      const estimate = await navigator.storage?.estimate?.();
      return { usage: estimate?.usage ?? null, quota: estimate?.quota ?? null };
    } catch {
      return { usage: null, quota: null };
    }
  }
}
