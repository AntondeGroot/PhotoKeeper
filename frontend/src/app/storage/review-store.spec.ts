import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { TestBed } from '@angular/core/testing';
import { ReviewStore } from './review-store';
import { Photo } from '../photo';

function photo(id: string): Photo {
  return {
    id,
    name: id,
    album: null,
    taken: '2026-01-01',
    status: 'backlog',
    kind: 'photo',
    starred: false,
    keepsake: false,
  };
}

describe('ReviewStore', () => {
  let store: ReviewStore;

  beforeEach(() => {
    indexedDB = new IDBFactory(); // fresh, empty database per test
    TestBed.configureTestingModule({});
    store = TestBed.inject(ReviewStore);
  });

  describe('verdicts', () => {
    it('persists a verdict and reads it back', async () => {
      await store.setVerdict('a1', { status: 'kept', starred: true, keepsake: false });

      const verdicts = await store.getVerdicts();
      expect(verdicts.get('a1')).toEqual({ status: 'kept', starred: true, keepsake: false });
    });

    it('overwrites an existing verdict for the same asset', async () => {
      await store.setVerdict('a1', { status: 'maybe', starred: false, keepsake: false });
      await store.setVerdict('a1', { status: 'rejected', starred: false, keepsake: false });

      const verdicts = await store.getVerdicts();
      expect(verdicts.size).toBe(1);
      expect(verdicts.get('a1')?.status).toBe('rejected');
    });

    it('returns an empty map when nothing is stored', async () => {
      expect((await store.getVerdicts()).size).toBe(0);
    });
  });

  describe('daily feed', () => {
    it('stores and reads the ordered selection for a date', async () => {
      const selection = [photo('a3'), photo('a1'), photo('a2')];
      await store.setDailyFeed('2026-06-16', selection);

      expect((await store.getDailyFeed('2026-06-16'))?.map((p) => p.id)).toEqual([
        'a3',
        'a1',
        'a2',
      ]);
    });

    it('returns undefined for a date with no selection', async () => {
      expect(await store.getDailyFeed('2099-01-01')).toBeUndefined();
    });

    it('prunes selections for days outside the keep set', async () => {
      await store.setDailyFeed('2026-06-16', [photo('a1')]); // yesterday
      await store.setDailyFeed('2026-06-17', [photo('a2')]); // today
      await store.setDailyFeed('2026-06-18', [photo('a3')]); // tomorrow

      await store.pruneDailyFeedExcept(new Set(['2026-06-17', '2026-06-18']));

      expect(await store.getDailyFeed('2026-06-16')).toBeUndefined();
      expect((await store.getDailyFeed('2026-06-17'))?.map((p) => p.id)).toEqual(['a2']);
      expect((await store.getDailyFeed('2026-06-18'))?.map((p) => p.id)).toEqual(['a3']);
    });
  });

  describe('album tags', () => {
    it('sets, reads, and removes an album tag', async () => {
      await store.setAlbumTag('alb-1', 'vacation');
      await store.setAlbumTag('alb-2', 'vacation');

      let tags = await store.getAlbumTags();
      expect([...tags.keys()]).toEqual(['alb-1', 'alb-2']);
      expect(tags.get('alb-1')).toBe('vacation');

      await store.removeAlbumTag('alb-1');
      tags = await store.getAlbumTags();
      expect([...tags.keys()]).toEqual(['alb-2']);
    });
  });
});
