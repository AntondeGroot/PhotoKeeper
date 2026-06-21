import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { TestBed } from '@angular/core/testing';
import { GroupOverrideStore, groupSignature } from './group-override-store';

describe('groupSignature', () => {
  it('is order-independent', () => {
    expect(groupSignature(['b', 'a', 'c'])).toBe(groupSignature(['c', 'b', 'a']));
  });

  it('differs for different member sets', () => {
    expect(groupSignature(['a', 'b'])).not.toBe(groupSignature(['a', 'b', 'c']));
  });
});

describe('GroupOverrideStore', () => {
  let store: GroupOverrideStore;

  beforeEach(() => {
    indexedDB = new IDBFactory(); // fresh, empty database per test
    TestBed.configureTestingModule({});
    store = TestBed.inject(GroupOverrideStore);
  });

  it('records a dissolved group and exposes its signature, order-independently', async () => {
    await store.dissolve({ memberIds: ['a', 'b'], dissolvedAt: 1 });

    const sigs = await store.signatures();
    expect(sigs.has(groupSignature(['b', 'a']))).toBe(true);
    expect((await store.getAll())[0]).toEqual({ memberIds: ['a', 'b'], dissolvedAt: 1 });
  });

  it('keeps one entry per member set (re-dissolving overwrites)', async () => {
    await store.dissolve({ memberIds: ['a', 'b'], dissolvedAt: 1 });
    await store.dissolve({ memberIds: ['b', 'a'], dissolvedAt: 2 });

    expect(await store.getAll()).toHaveLength(1);
    expect((await store.getAll())[0].dissolvedAt).toBe(2);
  });
});
