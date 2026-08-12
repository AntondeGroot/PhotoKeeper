import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { TestBed } from '@angular/core/testing';
import { CelebrationLogStore } from './celebration-log-store';

describe('CelebrationLogStore', () => {
  let store: CelebrationLogStore;

  beforeEach(() => {
    indexedDB = new IDBFactory(); // fresh, empty database per test
    TestBed.configureTestingModule({});
    store = TestBed.inject(CelebrationLogStore);
  });

  it('reads back an empty log, and keeps records apart by image id', async () => {
    // Empty must be {} rather than undefined: the picker spreads the log, and a missing entry is
    // how it knows an image has never been shown.
    expect(await store.load()).toEqual({});

    await store.put('valentine', { lastShown: 1000, count: 1, claims: ['2026'] });
    await store.put('winter', { lastShown: 2000, count: 4, claims: [] });
    await store.put('valentine', { lastShown: 3000, count: 2, claims: ['2026', '2027'] });

    expect(await store.load()).toEqual({
      valentine: { lastShown: 3000, count: 2, claims: ['2026', '2027'] },
      winter: { lastShown: 2000, count: 4, claims: [] },
    });
  });
});
