import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { TestBed } from '@angular/core/testing';
import { openDB } from 'idb';
import { PhotoKeeperDb } from './photokeeper-db';

describe('PhotoKeeperDb upgrades', () => {
  beforeEach(() => {
    indexedDB = new IDBFactory();
    TestBed.configureTestingModule({});
  });

  it('rebuilds queued review units on upgrade without touching what the user decided', async () => {
    // A device as it stands before the upgrade: a queue and a day's deck of units built when an
    // edit and its original were still two separate things, plus verdicts already recorded.
    const old = await openDB('photokeeper', 20, {
      upgrade(db) {
        for (const store of ['reviewBuffer', 'dailyFeed', 'verdicts', 'assetMeta']) {
          db.createObjectStore(store);
        }
      },
    });
    await old.put('reviewBuffer', [{ id: 'stale-unit', kind: 'burst' }], 'queue');
    await old.put('dailyFeed', [{ id: 'stale-unit' }], '2026-08-17');
    await old.put('verdicts', { status: 'kept' }, 'asset-1');
    await old.put('assetMeta', { albumId: 'al-1' }, 'asset-1');
    old.close();

    const db = await TestBed.inject(PhotoKeeperDb).open();

    // The units go, because they were assembled under rules that no longer hold. Leaving them is
    // what made the change invisible: the queue holds a couple of hundred, so old-shaped units keep
    // arriving for days after the code that built them is gone.
    expect(await db.get('reviewBuffer', 'queue')).toBeUndefined();
    expect(await db.get('dailyFeed', '2026-08-17')).toBeUndefined();

    // Verdicts are the record of somebody's work, not a cache — they are never rebuildable, so a
    // migration that cleared them would throw away real reviewing. The scanned metadata stays too,
    // so the queue refills from what is already on the device rather than re-fetching the catalog.
    expect(await db.get('verdicts', 'asset-1')).toEqual({ status: 'kept' });
    expect(await db.get('assetMeta', 'asset-1')).toEqual({ albumId: 'al-1' });
  });
});
