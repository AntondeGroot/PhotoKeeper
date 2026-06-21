import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { TestBed } from '@angular/core/testing';
import { TagStore } from './tag-store';

describe('TagStore', () => {
  let store: TagStore;

  beforeEach(() => {
    indexedDB = new IDBFactory(); // fresh DB per test
    localStorage.clear(); // reset the "seeded once" flag
    TestBed.configureTestingModule({});
    store = TestBed.inject(TagStore);
  });

  it('seeds the four default tags on first use', async () => {
    const tags = await store.getAll();
    expect(tags.map((t) => t.name)).toEqual(['Animals', 'Family', 'Friends', 'Nature']);
  });

  it('adds a new tag and returns it', async () => {
    const added = await store.add('Architecture');
    expect(added?.name).toBe('Architecture');
    const names = (await store.getAll()).map((t) => t.name);
    expect(names).toContain('Architecture');
  });

  it('de-duplicates by name (case-insensitive), returning the existing tag', async () => {
    const again = await store.add('animals'); // 'Animals' already exists
    expect(again?.id).toBe('animals');
    expect((await store.getAll()).filter((t) => t.name.toLowerCase() === 'animals')).toHaveLength(
      1,
    );
  });

  it('rejects a blank tag name', async () => {
    expect(await store.add('   ')).toBeNull();
    expect(await store.getAll()).toHaveLength(4); // unchanged
  });

  it('renames a tag in place, keeping its id', async () => {
    await store.getAll(); // seed the defaults first (as the app does on load)
    await store.rename('animals', 'Pets');
    const tag = (await store.getAll()).find((t) => t.id === 'animals');
    expect(tag?.name).toBe('Pets');
  });

  it('removes a tag, and a deleted default stays deleted (no re-seed)', async () => {
    await store.getAll(); // trigger the one-time seed
    await store.remove('friends');
    expect((await store.getAll()).map((t) => t.id)).not.toContain('friends');
  });
});
