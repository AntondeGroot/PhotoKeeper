import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { TestBed } from '@angular/core/testing';
import { DeletionLogStore } from './deletion-log-store';

describe('DeletionLogStore', () => {
  let store: DeletionLogStore;

  beforeEach(() => {
    indexedDB = new IDBFactory(); // a fresh database per test
    TestBed.configureTestingModule({});
    store = TestBed.inject(DeletionLogStore);
  });

  it('writes down each deletion and counts them', async () => {
    expect(await store.noteAll(['x', 'y'], 'KeeperDelete', '2026-09-12')).toBe(2);
    expect(await store.count()).toBe(2);
  });

  /**
   * The same tombstone is seen by every check that runs in the thirty days before it is purged, so
   * "new since last time" is what a caller needs back.
   */
  it('says how many were new, not how many it was handed', async () => {
    await store.noteAll(['x'], 'KeeperDelete', '2026-09-12');

    expect(await store.noteAll(['x', 'y'], 'KeeperDelete', '2026-09-13')).toBe(1);
    expect(await store.count()).toBe(2);
  });

  /**
   * The day a deletion was first noticed is the day it belongs on. Rewriting it on every sighting
   * would walk every deletion forward to today and collapse the history into one spike.
   */
  it('keeps the day a photograph was first seen deleted', async () => {
    await store.noteAll(['x'], 'KeeperDelete', '2026-09-12');
    await store.noteAll(['x'], 'KeeperDelete', '2026-09-30');

    expect((await store.all()).get('x')?.day).toBe('2026-09-12');
  });

  it('starts at nothing', async () => {
    expect(await store.count()).toBe(0);
    expect(await store.all()).toEqual(new Map());
  });
});
