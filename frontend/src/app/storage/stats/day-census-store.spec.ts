import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { TestBed } from '@angular/core/testing';
import { DayCensusStore } from './day-census-store';
import { emptyCensus } from '../../stats/census';

describe('DayCensusStore', () => {
  let store: DayCensusStore;

  beforeEach(() => {
    indexedDB = new IDBFactory(); // a fresh database per test
    TestBed.configureTestingModule({});
    store = TestBed.inject(DayCensusStore);
  });

  const day = (key: string, kept: number) => ({
    ...emptyCensus(key, 1_000),
    verdicts: { ...emptyCensus(key, 1_000).verdicts, kept },
  });

  it('keeps a day and reads it back', async () => {
    await store.put(day('2026-09-12', 7));

    expect((await store.get('2026-09-12'))?.verdicts.kept).toBe(7);
  });

  it('has nothing for a day never recorded', async () => {
    expect(await store.get('2026-01-01')).toBeUndefined();
  });

  /** Today's row is rewritten as the day goes on, so a day must never accumulate rows. */
  it('replaces the row for a day already written', async () => {
    await store.put(day('2026-09-12', 1));
    await store.put(day('2026-09-12', 9));

    expect(await store.history()).toEqual([expect.objectContaining({ day: '2026-09-12' })]);
    expect((await store.get('2026-09-12'))?.verdicts.kept).toBe(9);
  });

  /** The chart reads them as a series, so the order has to be the days' own, not the write order. */
  it('hands back the history oldest first', async () => {
    await store.put(day('2026-09-12', 1));
    await store.put(day('2026-09-10', 1));
    await store.put(day('2026-09-11', 1));

    expect((await store.history()).map((row) => row.day)).toEqual([
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
    ]);
  });
});
