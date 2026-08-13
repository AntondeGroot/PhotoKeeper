import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { TestBed } from '@angular/core/testing';
import { BacklogStatusService } from './backlog-status.service';
import { AssetMetaStore } from '../storage/review/asset-meta-store';
import { ReviewStore } from '../storage/review/review-store';
import { ReviewStatus } from '../photo';
import { PreferencesService } from '../preferences.service';
import { AssetTagStore } from '../storage/tags/asset-tag-store';

describe('BacklogStatusService', () => {
  let service: BacklogStatusService;
  let meta: AssetMetaStore;
  let reviews: ReviewStore;

  beforeEach(() => {
    indexedDB = new IDBFactory(); // fresh, empty database per test
    localStorage.clear(); // preferences persist there, and would leak between tests
    TestBed.configureTestingModule({});
    service = TestBed.inject(BacklogStatusService);
    meta = TestBed.inject(AssetMetaStore);
    reviews = TestBed.inject(ReviewStore);
  });

  /** Puts an asset in the library and gives it a verdict. */
  async function asset(id: string, status: ReviewStatus): Promise<void> {
    await meta.put(id, { albumId: 'a', name: id, taken: '2026-01-01' });
    await reviews.setVerdict(id, { status, starred: false, keepsake: false });
  }

  it('assumes there is work when the library population is unknown', async () => {
    // Nothing scanned yet — a fresh install, or before the first background scan finishes. The
    // library is not "clear", we simply cannot see it, and answering "no work" here would pause
    // every streak forever without anyone noticing.
    expect(await service.hasWorkWaiting()).toBe(true);
  });

  it('reports no work once every photo is sorted and nothing awaits editing', async () => {
    await asset('a1', 'kept');
    await asset('a2', 'rejected');
    await asset('a3', 'toPrint'); // ordered, in the post — nothing the user can do about it

    expect(await service.hasWorkWaiting()).toBe(false);
  });

  it('counts untagged keepers only while tagging is switched on', async () => {
    await asset('a1', 'kept'); // a keeper with no tags

    // Tagging off: there is no tagging task, so an untagged keeper is not work.
    expect(await service.hasWorkWaiting()).toBe(false);

    TestBed.inject(PreferencesService).taggingEnabled.set(true);
    expect(await service.hasWorkWaiting()).toBe(true);

    await TestBed.inject(AssetTagStore).set('a1', ['animals']);
    expect(await service.hasWorkWaiting()).toBe(false);
  });

  it('counts a photo waiting to be edited, until editing moves it on', async () => {
    await asset('a1', 'kept');
    await asset('a2', 'toEdit');

    expect(await service.hasWorkWaiting()).toBe(true);

    // Editing promotes it to toPrint, which is the only thing that marks the job done.
    await reviews.setVerdict('a2', { status: 'toPrint', starred: false, keepsake: false });

    expect(await service.hasWorkWaiting()).toBe(false);
  });
});
