import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { TestBed } from '@angular/core/testing';
import { AssetMetaStore } from './asset-meta-store';
import { AssetMeta } from '../photokeeper-db';

const meta = (albumId: string, name: string, taken = '2026-05-01T10:00:00Z'): AssetMeta => ({
  albumId,
  name,
  taken,
});

describe('AssetMetaStore', () => {
  let store: AssetMetaStore;

  beforeEach(() => {
    indexedDB = new IDBFactory(); // fresh, empty database per test
    TestBed.configureTestingModule({});
    store = TestBed.inject(AssetMetaStore);
  });

  it('persists metadata and reads it back', async () => {
    await store.put('a1', meta('alb-1', 'IMG_1'));
    expect(await store.get('a1')).toEqual(meta('alb-1', 'IMG_1'));
  });

  it('returns undefined when nothing is stored', async () => {
    expect(await store.get('missing')).toBeUndefined();
  });

  it('reads all metadata as a map', async () => {
    await store.put('a1', meta('alb-1', 'IMG_1'));
    await store.put('a2', meta('alb-1', 'IMG_2'));

    const all = await store.getAll();
    expect(all.size).toBe(2);
    expect(all.get('a2')?.name).toBe('IMG_2');
  });

  it('deletes metadata', async () => {
    await store.put('a1', meta('alb-1', 'IMG_1'));
    await store.delete('a1');
    expect(await store.get('a1')).toBeUndefined();
  });
});
