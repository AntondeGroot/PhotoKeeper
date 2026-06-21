import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { TestBed } from '@angular/core/testing';
import { HashStore } from './hash-store';

describe('HashStore', () => {
  let store: HashStore;

  beforeEach(() => {
    indexedDB = new IDBFactory(); // fresh, empty database per test
    TestBed.configureTestingModule({});
    store = TestBed.inject(HashStore);
  });

  it('persists a hash and reads it back', async () => {
    await store.put('a1', 'aaaaaaaaaaaaaaaa');
    expect(await store.get('a1')).toBe('aaaaaaaaaaaaaaaa');
  });

  it('overwrites an existing hash for the same asset', async () => {
    await store.put('a1', 'aaaaaaaaaaaaaaaa');
    await store.put('a1', 'bbbbbbbbbbbbbbbb');
    expect(await store.get('a1')).toBe('bbbbbbbbbbbbbbbb');
  });

  it('returns undefined when nothing is stored', async () => {
    expect(await store.get('missing')).toBeUndefined();
  });

  it('reads all hashes as a map', async () => {
    await store.put('a1', '1111111111111111');
    await store.put('a2', '2222222222222222');

    const all = await store.getAll();
    expect(all.size).toBe(2);
    expect(all.get('a1')).toBe('1111111111111111');
    expect(all.get('a2')).toBe('2222222222222222');
  });

  it('deletes a hash', async () => {
    await store.put('a1', '1111111111111111');
    await store.delete('a1');
    expect(await store.get('a1')).toBeUndefined();
  });
});
