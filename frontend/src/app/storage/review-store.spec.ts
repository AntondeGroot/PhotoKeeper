import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { TestBed } from '@angular/core/testing';
import { ReviewStore } from './review-store';

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
      await store.setDailyFeed('2026-06-16', ['a3', 'a1', 'a2']);

      expect(await store.getDailyFeed('2026-06-16')).toEqual(['a3', 'a1', 'a2']);
    });

    it('returns undefined for a date with no selection', async () => {
      expect(await store.getDailyFeed('2099-01-01')).toBeUndefined();
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
