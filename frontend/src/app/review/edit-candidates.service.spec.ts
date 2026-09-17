import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { EditCandidatesService } from './edit-candidates.service';
import { KeeperAlbumsService } from '../keeper-albums.service';
import { PreferencesService } from '../preferences.service';
import { AssetMetaStore } from '../storage/review/asset-meta-store';
import { KeeperFilingStore } from '../storage/review/keeper-filing-store';
import { ReviewStore } from '../storage/review/review-store';
import { MergeFinderService } from './merge-finder.service';
import { AssetMeta, FiledRecord, StoredVerdict } from '../storage/photokeeper-db';

const meta = (name: string, albumId = 'alb-1'): AssetMeta => ({
  albumId,
  name,
  ext: 'NEF',
  taken: '2026-05-01',
});
const verdict = (status: StoredVerdict['status']): StoredVerdict => ({
  status,
  starred: false,
  saveOnly: false,
});
const filed = (albums: string[], at: number): FiledRecord => ({ albums, at });

describe('EditCandidatesService', () => {
  let service: EditCandidatesService;
  let verdicts: Map<string, StoredVerdict>;
  let assets: Map<string, AssetMeta>;
  let records: Map<string, FiledRecord>;
  let editGoal: number;
  /** Frames Lightroom has already merged into a panorama — finished, whatever the verdict says. */
  let mergedFrames: Set<string>;

  beforeEach(() => {
    verdicts = new Map();
    assets = new Map();
    records = new Map();
    editGoal = 3;
    mergedFrames = new Set();

    TestBed.configureTestingModule({
      providers: [
        { provide: ReviewStore, useValue: { getVerdicts: () => Promise.resolve(verdicts) } },
        { provide: AssetMetaStore, useValue: { getAll: () => Promise.resolve(assets) } },
        { provide: KeeperFilingStore, useValue: { getAll: () => Promise.resolve(records) } },
        {
          provide: KeeperAlbumsService,
          useValue: { nameFor: (id: string) => (id === 'alb-1' ? 'Iceland' : null) },
        },
        { provide: PreferencesService, useValue: { editGoal: () => editGoal } },
        {
          provide: MergeFinderService,
          useValue: {
            merges: signal([]),
            frameIds: () => mergedFrames,
            refresh: () => Promise.resolve(),
          },
        },
      ],
    });
    service = TestBed.inject(EditCandidatesService);
  });

  /** Three photographs in the album, put there on different days. */
  function threeWaiting(): void {
    for (const [id, at] of [
      ['newest', 300],
      ['oldest', 100],
      ['middle', 200],
    ] as const) {
      verdicts.set(id, verdict('toEdit'));
      assets.set(id, meta(id));
      records.set(id, filed(['KeeperEdit'], at));
    }
  }

  /**
   * The bug this exists for: the tab listed the few photographs of *today's deck* that happened to
   * be marked for editing — often none — and said the queue was clear while KeeperEdit held four
   * hundred waiting for exactly this.
   */
  it('offers what the album holds, longest wait first', async () => {
    threeWaiting();

    await service.refresh();

    expect(service.all().map((p) => p.id)).toEqual(['oldest', 'middle', 'newest']);
  });

  it('offers the editing goal’s worth at a time', async () => {
    threeWaiting();
    editGoal = 2;

    await service.refresh();

    expect(service.batch().map((p) => p.id)).toEqual(['oldest', 'middle']);
  });

  /** A photograph that has been edited is not waiting for anything. */
  it('leaves out one that has been finished', async () => {
    threeWaiting();
    verdicts.set('oldest', verdict('toPrint'));

    await service.refresh();

    expect(service.all().map((p) => p.id)).toEqual(['middle', 'newest']);
  });

  /**
   * One decided for editing but still waiting for room in the album cannot be edited yet: sending
   * the user to Lightroom to find a photograph that is not there would be worse than not offering it.
   */
  it('leaves out one the album has not been given yet', async () => {
    verdicts.set('waiting', verdict('toEdit'));
    assets.set('waiting', meta('waiting'));

    await service.refresh();

    expect(service.all()).toEqual([]);
  });

  it('leaves out one filed somewhere else entirely', async () => {
    verdicts.set('rejected', verdict('rejected'));
    assets.set('rejected', meta('rejected'));
    records.set('rejected', filed(['KeeperDelete'], 100));

    await service.refresh();

    expect(service.all()).toEqual([]);
  });

  it('names each photograph and the album it came from', async () => {
    threeWaiting();

    await service.refresh();

    expect(service.all()[0]).toMatchObject({ name: 'oldest', ext: 'NEF', album: 'Iceland' });
  });

  /** A photograph the scan has never reached still opens in Lightroom, so it is still offered. */
  it('offers one the scan has no name for', async () => {
    verdicts.set('unknown', verdict('toEdit'));
    records.set('unknown', filed(['KeeperEdit'], 100));

    await service.refresh();

    expect(service.all()).toMatchObject([{ id: 'unknown', name: 'unknown', album: null }]);
  });

  /** "Clear" is about the album, not about today. */
  it('is empty only when the album has nothing waiting', async () => {
    expect(service.empty()).toBe(true);

    threeWaiting();
    await service.refresh();

    expect(service.empty()).toBe(false);
  });

  /**
   * Both of these were being offered on a real phone. The first is not a photograph at all, and the
   * second is a sweep that was stitched weeks ago — so the tab was asking for editing that either
   * cannot be done or has already been done.
   */
  describe('what is never work to offer', () => {
    it('leaves out a group card’s own id, which is not a photograph', async () => {
      verdicts.set('pano:alb-1:f1', verdict('toEdit'));
      records.set('pano:alb-1:f1', filed(['KeeperEdit'], 100));

      await service.refresh();

      expect(service.all()).toEqual([]);
    });

    /** The sweep is already a panorama; what is left is confirming it, not editing it again. */
    it('leaves out frames whose panorama Lightroom has already written', async () => {
      threeWaiting();
      mergedFrames = new Set(['oldest', 'middle']);

      await service.refresh();

      expect(service.all().map((p) => p.id)).toEqual(['newest']);
    });
  });
});
