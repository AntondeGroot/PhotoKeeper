import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { TestBed } from '@angular/core/testing';
import { RenditionStore } from './rendition-store';

// Note: fake-indexeddb + jsdom don't preserve Blob byte fidelity across a round-trip, so these
// assert on presence/absence (the store's keying + eviction logic) rather than blob contents — the
// real platform stores Blobs natively.
describe('RenditionStore', () => {
  let store: RenditionStore;

  beforeEach(() => {
    indexedDB = new IDBFactory(); // fresh, empty database per test
    TestBed.configureTestingModule({});
    store = TestBed.inject(RenditionStore);
  });

  it('stores a rendition and retrieves it by asset id and size', async () => {
    await store.put('a1', '2048', new Blob(['image-bytes']));

    expect(await store.get('a1', '2048')).toBeDefined();
  });

  it('keys renditions by size: a different size is a different entry', async () => {
    await store.put('a1', '2048', new Blob(['big']));

    expect(await store.get('a1', '2048')).toBeDefined();
    expect(await store.get('a1', '640')).toBeUndefined();
  });

  it('returns undefined for an unknown rendition', async () => {
    expect(await store.get('nope', '2048')).toBeUndefined();
  });

  it('evicts renditions whose asset id is not kept', async () => {
    await store.put('a1', '2048', new Blob(['1']));
    await store.put('a2', '2048', new Blob(['2']));
    await store.put('a3', '640', new Blob(['3']));

    await store.evictExcept(new Set(['a2']));

    expect(await store.get('a1', '2048')).toBeUndefined();
    expect(await store.get('a2', '2048')).toBeDefined();
    expect(await store.get('a3', '640')).toBeUndefined();
  });
});
