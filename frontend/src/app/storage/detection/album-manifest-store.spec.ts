import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { TestBed } from '@angular/core/testing';
import { AlbumManifestStore, computeAlbumManifest, diffManifest } from './album-manifest-store';

const asset = (id: string, updated = 'v1') => ({ id, updated });

describe('computeAlbumManifest', () => {
  it('hashes order-independently for the same population', () => {
    const a = computeAlbumManifest([asset('a'), asset('b'), asset('c')], 0);
    const b = computeAlbumManifest([asset('c'), asset('a'), asset('b')], 0);
    expect(a.hash).toBe(b.hash);
  });

  it('hash changes when an asset is added, removed, or edited', () => {
    const base = computeAlbumManifest([asset('a'), asset('b')], 0).hash;
    expect(computeAlbumManifest([asset('a'), asset('b'), asset('c')], 0).hash).not.toBe(base);
    expect(computeAlbumManifest([asset('a')], 0).hash).not.toBe(base);
    expect(computeAlbumManifest([asset('a'), asset('b', 'v2')], 0).hash).not.toBe(base);
  });

  it('stores sorted fingerprints, an 8-char hex hash, the cursor, and the given timestamp', () => {
    const m = computeAlbumManifest([asset('b'), asset('a')], 5, 1234);
    expect(m.fingerprints.map((f) => f.id)).toEqual(['a', 'b']);
    expect(m.hash).toMatch(/^[0-9a-f]{8}$/);
    expect(m.scanned).toBe(5);
    expect(m.computedAt).toBe(1234);
  });

  it('treats a missing updated stamp as empty', () => {
    expect(computeAlbumManifest([{ id: 'a' }], 0).hash).toBe(
      computeAlbumManifest([asset('a', '')], 0).hash,
    );
  });
});

describe('diffManifest', () => {
  it('reports every asset as added when there is no stored manifest', () => {
    expect(diffManifest(undefined, [asset('a'), asset('b')])).toEqual({
      added: ['a', 'b'],
      removed: [],
      changed: [],
    });
  });

  it('classifies added, removed, and edited assets', () => {
    const stored = computeAlbumManifest([asset('a'), asset('b'), asset('c')], 0);
    const diff = diffManifest(stored, [asset('a'), asset('b', 'v2'), asset('d')]);
    expect(diff.added).toEqual(['d']);
    expect(diff.removed).toEqual(['c']);
    expect(diff.changed).toEqual(['b']);
  });

  it('is empty when nothing changed', () => {
    const stored = computeAlbumManifest([asset('a'), asset('b')], 0);
    expect(diffManifest(stored, [asset('b'), asset('a')])).toEqual({
      added: [],
      removed: [],
      changed: [],
    });
  });
});

describe('AlbumManifestStore', () => {
  let store: AlbumManifestStore;

  beforeEach(() => {
    indexedDB = new IDBFactory(); // fresh, empty database per test
    TestBed.configureTestingModule({});
    store = TestBed.inject(AlbumManifestStore);
  });

  it('persists a manifest and reads it back', async () => {
    await store.record('alb-1', [asset('a'), asset('b')]);
    const stored = await store.get('alb-1');
    expect(stored?.fingerprints.map((f) => f.id)).toEqual(['a', 'b']);
  });

  it('scan() flags a never-scanned album as changed with everything added', async () => {
    const { unchanged, diff } = await store.scan('new', [asset('a')]);
    expect(unchanged).toBe(false);
    expect(diff.added).toEqual(['a']);
  });

  it('scan() reports unchanged when the population matches the recorded manifest', async () => {
    await store.record('alb-1', [asset('a'), asset('b')]);
    const { unchanged, diff } = await store.scan('alb-1', [asset('b'), asset('a')]);
    expect(unchanged).toBe(true);
    expect(diff).toEqual({ added: [], removed: [], changed: [] });
  });

  it('scan() returns the precise diff when the population changed', async () => {
    await store.record('alb-1', [asset('a'), asset('b')]);
    const { unchanged, diff } = await store.scan('alb-1', [asset('a', 'v2'), asset('c')]);
    expect(unchanged).toBe(false);
    expect(diff).toEqual({ added: ['c'], removed: ['b'], changed: ['a'] });
  });

  it('deletes a manifest', async () => {
    await store.record('alb-1', [asset('a')]);
    await store.delete('alb-1');
    expect(await store.get('alb-1')).toBeUndefined();
  });

  it('clear() drops every manifest so albums re-detect', async () => {
    await store.record('alb-1', [asset('a')]);
    await store.record('alb-2', [asset('b')]);

    await store.clear();

    expect(await store.get('alb-1')).toBeUndefined();
    expect(await store.scan('alb-2', [asset('b')])).toMatchObject({ unchanged: false });
  });
});
