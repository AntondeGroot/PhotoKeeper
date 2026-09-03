import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { TestBed } from '@angular/core/testing';
import { ReviewStore } from './review-store';
import { Photo } from '../../photo';

function photo(id: string): Photo {
  return {
    id,
    name: id,
    album: null,
    taken: '2026-01-01',
    status: 'backlog',
    kind: 'photo',
    starred: false,
    saveOnly: false,
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
      await store.setVerdict('a1', { status: 'kept', starred: true, saveOnly: false });

      const verdicts = await store.getVerdicts();
      expect(verdicts.get('a1')).toEqual({ status: 'kept', starred: true, saveOnly: false });
    });

    it('reads the store once, then keeps the cache in step with new verdicts', async () => {
      await store.setVerdict('a1', { status: 'kept', starred: false, saveOnly: false });
      const first = await store.getVerdicts();

      // The map is reused rather than rebuilt: every feed build, scan and streak check asks for
      // this, and rereading the whole library each time is the cost being removed.
      expect(await store.getVerdicts()).toBe(first);

      // A later decision is written through, so the cache cannot go stale behind a caller's back.
      await store.setVerdict('a2', { status: 'rejected', starred: false, saveOnly: false });
      expect((await store.getVerdicts()).get('a2')?.status).toBe('rejected');
      expect((await store.getVerdicts()).size).toBe(2);
    });

    it('overwrites an existing verdict for the same asset', async () => {
      await store.setVerdict('a1', { status: 'maybe', starred: false, saveOnly: false });
      await store.setVerdict('a1', { status: 'rejected', starred: false, saveOnly: false });

      const verdicts = await store.getVerdicts();
      expect(verdicts.size).toBe(1);
      expect(verdicts.get('a1')?.status).toBe('rejected');
    });

    it('setSaveOnly changes that flag alone, and ignores a photo with no verdict', async () => {
      await store.setVerdict('a1', { status: 'toPrint', starred: true, saveOnly: false });

      await store.setSaveOnly('a1', true);

      // The Prints tab knows about printing, not about sorting. The rest of the verdict has to come
      // back untouched, or choosing what to print would quietly undo a swipe.
      expect((await store.getVerdicts()).get('a1')).toEqual({
        status: 'toPrint',
        starred: true,
        saveOnly: true,
      });

      // An id with nothing stored is a photo that was never sorted, so there is no print choice to
      // record — inventing a verdict here would slip it into an album's print set.
      await store.setSaveOnly('ghost', true);
      expect((await store.getVerdicts()).has('ghost')).toBe(false);
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
