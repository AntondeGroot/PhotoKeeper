import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { TestBed } from '@angular/core/testing';
import { AssetTagStore } from './asset-tag-store';

describe('AssetTagStore', () => {
  let store: AssetTagStore;

  beforeEach(() => {
    indexedDB = new IDBFactory();
    TestBed.configureTestingModule({});
    store = TestBed.inject(AssetTagStore);
  });

  it('returns an empty array for an untagged photo', async () => {
    expect(await store.get('IMG_1')).toEqual([]);
  });

  it('stores and reads a photo’s tag ids', async () => {
    await store.set('IMG_1', ['animals', 'nature']);
    expect(await store.get('IMG_1')).toEqual(['animals', 'nature']);
  });

  it('removes the row when the tag set becomes empty', async () => {
    await store.set('IMG_1', ['animals']);
    await store.set('IMG_1', []);
    expect(await store.get('IMG_1')).toEqual([]);
    expect(Object.keys(await store.getAll())).not.toContain('IMG_1');
  });

  it('returns all assignments as a map', async () => {
    await store.set('IMG_1', ['animals']);
    await store.set('IMG_2', ['family', 'friends']);
    expect(await store.getAll()).toEqual({
      IMG_1: ['animals'],
      IMG_2: ['family', 'friends'],
    });
  });
});
