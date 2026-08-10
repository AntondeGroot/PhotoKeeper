import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { TestBed } from '@angular/core/testing';
import { GroupOverrideStore, coversSameGroup, groupSignature } from './group-override-store';

describe('coversSameGroup', () => {
  it('matches the identical set, however ordered', () => {
    expect(coversSameGroup(['a', 'b', 'c'], ['c', 'a', 'b'])).toBe(true);
  });

  // The case exact-signature matching lost: re-detecting at a different burst window shifts a group
  // by a frame, and the user's correction silently stopped applying.
  it('still matches when re-detection added a frame', () => {
    expect(coversSameGroup(['a', 'b', 'c'], ['a', 'b', 'c', 'd'])).toBe(true);
  });

  it('still matches when re-detection dropped a frame', () => {
    expect(coversSameGroup(['a', 'b', 'c'], ['a', 'b'])).toBe(true);
  });

  it('refuses a group that merely brushes against the recorded one', () => {
    // Shares 'c' only: 1 of the 5 frames they cover between them.
    expect(coversSameGroup(['a', 'b', 'c'], ['c', 'd', 'e'])).toBe(false);
  });

  it('refuses an exact half, so a correction needs a majority to travel', () => {
    // Shares a+b of the 4 covered — exactly half, deliberately not enough.
    expect(coversSameGroup(['a', 'b'], ['a', 'b', 'c', 'd'])).toBe(false);
  });

  it('refuses a disjoint group', () => {
    expect(coversSameGroup(['a', 'b'], ['c', 'd'])).toBe(false);
  });

  it('refuses an empty detected group rather than matching everything', () => {
    expect(coversSameGroup(['a', 'b'], [])).toBe(false);
    expect(coversSameGroup([], [])).toBe(false);
  });
});

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

  it('records a dissolved group with its member set intact', async () => {
    await store.dissolve({ memberIds: ['a', 'b'], dissolvedAt: 1 });

    expect(await store.getAll()).toEqual([{ memberIds: ['a', 'b'], dissolvedAt: 1 }]);
  });

  it('keeps one entry per member set (re-dissolving overwrites)', async () => {
    await store.dissolve({ memberIds: ['a', 'b'], dissolvedAt: 1 });
    await store.dissolve({ memberIds: ['b', 'a'], dissolvedAt: 2 });

    expect(await store.getAll()).toHaveLength(1);
    expect((await store.getAll())[0].dissolvedAt).toBe(2);
  });
});
