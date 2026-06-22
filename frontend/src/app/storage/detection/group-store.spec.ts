import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { TestBed } from '@angular/core/testing';
import { GroupStore } from './group-store';
import { DetectedGroup } from '../../detection/detection-types';

const burst = (sourceAlbumId: string, memberIds: string[]): DetectedGroup => ({
  type: 'burst',
  sourceAlbumId,
  memberIds,
});

describe('GroupStore', () => {
  let store: GroupStore;

  beforeEach(() => {
    indexedDB = new IDBFactory(); // fresh, empty database per test
    TestBed.configureTestingModule({});
    store = TestBed.inject(GroupStore);
  });

  it('stores groups for an album and reads them back', async () => {
    await store.replaceForAlbum('alb-1', [burst('alb-1', ['a', 'b'])]);
    const groups = await store.getByAlbum('alb-1');
    expect(groups).toEqual([burst('alb-1', ['a', 'b'])]);
  });

  it('getByAlbum returns only the requested album’s groups', async () => {
    await store.replaceForAlbum('alb-1', [burst('alb-1', ['a', 'b'])]);
    await store.replaceForAlbum('alb-2', [burst('alb-2', ['c', 'd'])]);

    expect(await store.getByAlbum('alb-1')).toEqual([burst('alb-1', ['a', 'b'])]);
    expect((await store.getAll()).length).toBe(2);
  });

  it('replaceForAlbum overwrites an album’s groups without touching other albums', async () => {
    await store.replaceForAlbum('alb-1', [burst('alb-1', ['a', 'b']), burst('alb-1', ['x', 'y'])]);
    await store.replaceForAlbum('alb-2', [burst('alb-2', ['c', 'd'])]);

    await store.replaceForAlbum('alb-1', [burst('alb-1', ['a', 'b', 'z'])]);

    expect(await store.getByAlbum('alb-1')).toEqual([burst('alb-1', ['a', 'b', 'z'])]);
    expect(await store.getByAlbum('alb-2')).toEqual([burst('alb-2', ['c', 'd'])]);
  });

  it('replaceForAlbum with an empty list clears the album', async () => {
    await store.replaceForAlbum('alb-1', [burst('alb-1', ['a', 'b'])]);
    await store.replaceForAlbum('alb-1', []);
    expect(await store.getByAlbum('alb-1')).toEqual([]);
  });
});
