import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { CensusService } from './census.service';
import { DayCensus } from './census';
import { DayService } from '../review/day.service';
import { AssetMetaStore } from '../storage/review/asset-meta-store';
import { DayCensusStore } from '../storage/stats/day-census-store';
import { DeletionLogStore } from '../storage/stats/deletion-log-store';
import { ReviewStore } from '../storage/review/review-store';
import { AssetMeta, StoredVerdict } from '../storage/photokeeper-db';

const meta = (name: string): AssetMeta => ({ albumId: 'alb', name, taken: '2026-05-01' });
const verdict = (status: StoredVerdict['status']): StoredVerdict => ({
  status,
  starred: false,
  saveOnly: false,
});

describe('CensusService', () => {
  let service: CensusService;
  let assets: Map<string, AssetMeta>;
  let verdicts: Map<string, StoredVerdict>;
  let rows: Map<string, DayCensus>;
  /** The ledger of deletions seen, which outlives the tombstones it was built from. */
  let ledger: Map<string, { day: string; album: string }>;
  let today: ReturnType<typeof signal<string>>;

  beforeEach(() => {
    assets = new Map([
      ['a', meta('DSC_1')],
      ['b', meta('DSC_2')],
      ['c', meta('DSC_3')],
    ]);
    verdicts = new Map();
    rows = new Map();
    ledger = new Map();
    today = signal('2026-09-12');

    TestBed.configureTestingModule({
      providers: [
        { provide: AssetMetaStore, useValue: { getAll: () => Promise.resolve(assets) } },
        { provide: ReviewStore, useValue: { getVerdicts: () => Promise.resolve(verdicts) } },
        { provide: DayService, useValue: { today } },
        {
          provide: DeletionLogStore,
          useValue: {
            // First sighting wins, as the real store does.
            noteAll: (ids: string[], album: string, day: string) => {
              let added = 0;
              for (const id of ids) {
                if (ledger.has(id)) continue;
                ledger.set(id, { day, album });
                added++;
              }
              return Promise.resolve(added);
            },
            count: () => Promise.resolve(ledger.size),
          },
        },
        {
          provide: DayCensusStore,
          useValue: {
            get: (day: string) => Promise.resolve(rows.get(day)),
            put: (row: DayCensus) => {
              rows.set(row.day, row);
              return Promise.resolve();
            },
            history: () =>
              Promise.resolve([...rows.values()].sort((a, b) => a.day.localeCompare(b.day))),
          },
        },
      ],
    });
    service = TestBed.inject(CensusService);
  });

  it('counts the library and what has been decided about it', async () => {
    verdicts.set('a', verdict('kept'));
    verdicts.set('b', verdict('rejected'));

    const census = await service.recordToday();

    expect(census.known).toBe(3);
    expect(census.verdicts.kept).toBe(1);
    expect(census.verdicts.rejected).toBe(1);
    expect(census.verdicts.backlog).toBe(1); // 'c', never ruled on
  });

  it('writes the row under today, so a day can be read back', async () => {
    await service.recordToday();

    expect(rows.get('2026-09-12')?.day).toBe('2026-09-12');
  });

  /**
   * The photographs behind a burst or a panorama carry their own verdicts; the card's own id is not
   * a photograph, and counting it would say the library holds more than it does.
   */
  it('does not count a group card as a photograph', async () => {
    verdicts.set('burst:alb:a', verdict('kept'));
    verdicts.set('a', verdict('kept'));

    const census = await service.recordToday();

    expect(census.verdicts.kept).toBe(1);
  });

  /**
   * A rejected photo that has since been deleted in Lightroom leaves the library, so `known` falls.
   * Without this the chart could not tell a shrinking library from one that was never scanned.
   */
  it('counts verdicts whose photograph has left the library', async () => {
    verdicts.set('a', verdict('kept'));
    verdicts.set('long-gone', verdict('rejected'));

    const census = await service.recordToday();

    expect(census.gone).toBe(1);
    expect(census.verdicts.rejected).toBe(1); // still what was decided, even once the photo is gone
  });

  it('overwrites today as the day goes on, so the row settles on the day’s last state', async () => {
    await service.recordToday();
    verdicts.set('a', verdict('kept'));

    const census = await service.recordToday();

    expect(census.verdicts.kept).toBe(1);
    expect([...rows.keys()]).toEqual(['2026-09-12']);
  });

  it('starts a new row when the day turns over, leaving yesterday as it was', async () => {
    verdicts.set('a', verdict('kept'));
    await service.recordToday();

    today.set('2026-09-13');
    verdicts.set('b', verdict('kept'));
    await service.recordToday();

    expect((await service.history()).map((row) => [row.day, row.verdicts.kept])).toEqual([
      ['2026-09-12', 1],
      ['2026-09-13', 2],
    ]);
  });

  describe('the Lightroom side', () => {
    it('records what an album holds, live photographs apart from deletions', async () => {
      await service.recordAlbum('KeeperDelete', { live: 4, deletedIds: ['x', 'y'] });

      expect(rows.get('2026-09-12')?.albums?.['KeeperDelete']).toMatchObject({
        live: 4,
        deleted: 2,
      });
    });

    /** The albums are looked at one at a time, so one must never wipe another. */
    it('keeps the albums recorded earlier today', async () => {
      await service.recordAlbum('KeeperDelete', { live: 1, deletedIds: ['x'] });
      await service.recordAlbum('KeeperEdit', { live: 3, deletedIds: [] });

      expect(Object.keys(rows.get('2026-09-12')?.albums ?? {})).toEqual([
        'KeeperDelete',
        'KeeperEdit',
      ]);
    });

    /**
     * The one this ledger exists for. A tombstone stands for thirty days and is then purged, so the
     * album's own count falls back to nothing while the deleting has in fact been done. Counting
     * that as "deleted" would draw a line that climbed for a month and then sank.
     */
    it('keeps counting a deletion after Lightroom has purged the tombstone', async () => {
      await service.recordAlbum('KeeperDelete', { live: 0, deletedIds: ['x', 'y', 'z'] });

      // Thirty days on: the tombstones are gone and the album lists nothing at all.
      await service.recordAlbum('KeeperDelete', { live: 0, deletedIds: [] });
      const census = await service.recordToday();

      expect(census.albums?.['KeeperDelete']).toMatchObject({ live: 0, deleted: 0 });
      expect(census.deletedEver).toBe(3);
    });

    /**
     * The row has to be right as it stands, not only once the device side has been counted again:
     * the last thing to write on a given day is often a tidy-up check, and that row is what the
     * chart reads. So the total comes from the ledger even here, never from what the album holds.
     */
    it('stores the ledger total on the row, not the album’s rolling count', async () => {
      await service.recordAlbum('KeeperDelete', { live: 0, deletedIds: ['x', 'y', 'z'] });
      await service.recordAlbum('KeeperDelete', { live: 0, deletedIds: [] }); // purged

      expect(rows.get('2026-09-12')?.deletedEver).toBe(3);
    });

    /** The same tombstone is seen by every check that runs inside its thirty days. */
    it('counts a photograph once however often it is seen deleted', async () => {
      await service.recordAlbum('KeeperDelete', { live: 1, deletedIds: ['x'] });
      await service.recordAlbum('KeeperDelete', { live: 1, deletedIds: ['x', 'y'] });

      expect((await service.recordToday()).deletedEver).toBe(2);
    });

    /**
     * The two sides are written by different things at different moments — the device side on every
     * launch, the albums only when something happens to list one — so neither may erase the other.
     */
    it('survives the device side being counted again afterwards', async () => {
      await service.recordAlbum('KeeperDelete', { live: 1, deletedIds: ['x'] });
      verdicts.set('a', verdict('rejected'));

      const census = await service.recordToday();

      expect(census.albums?.['KeeperDelete']).toMatchObject({ live: 1, deleted: 1 });
      expect(census.verdicts.rejected).toBe(1);
    });
  });
});
