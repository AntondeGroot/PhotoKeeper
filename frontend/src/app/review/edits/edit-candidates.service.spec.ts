import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { EditCandidatesService } from './edit-candidates.service';
import { KeeperAlbumsService } from '../../keeper-albums.service';
import { PreferencesService } from '../../preferences.service';
import { AssetMetaStore } from '../../storage/review/asset-meta-store';
import { KeeperFilingStore } from '../../storage/review/keeper-filing-store';
import { ReviewStore } from '../../storage/review/review-store';
import { MergeFinderService } from './merge-finder.service';
import { CorrectedGroupsService } from '../deck/selection/corrected-groups.service';
import { CensusService } from '../../stats/census.service';
import { EditAlbumNamesService } from './edit-album-names.service';
import { PhotoAsset } from '../../lightroom-types';
import { DetectedGroup } from '../../detection/detectors/detection-types';
import { AssetMeta, FiledRecord, StoredVerdict } from '../../storage/photokeeper-db';

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
  /** The groups as corrected by the user. */
  let groups: DetectedGroup[];
  /** Whether the catalogue has answered, which is when album names become known. */
  let albumsChecked: ReturnType<typeof signal<boolean>>;
  /** Photographs an album listing has seen deleted in Lightroom. */
  let seenDeleted: Set<string>;

  beforeEach(() => {
    verdicts = new Map();
    assets = new Map();
    records = new Map();
    editGoal = 3;
    mergedFrames = new Set();
    groups = [];
    albumsChecked = signal(false);
    seenDeleted = new Set();

    TestBed.configureTestingModule({
      providers: [
        { provide: ReviewStore, useValue: { getVerdicts: () => Promise.resolve(verdicts) } },
        { provide: AssetMetaStore, useValue: { getAll: () => Promise.resolve(assets) } },
        { provide: KeeperFilingStore, useValue: { getAll: () => Promise.resolve(records) } },
        {
          provide: KeeperAlbumsService,
          useValue: {
            nameFor: (id: string) => (id === 'alb-1' ? 'Iceland' : null),
            checked: albumsChecked,
          },
        },
        { provide: PreferencesService, useValue: { editGoal: () => editGoal } },
        { provide: CorrectedGroupsService, useValue: { all: () => Promise.resolve(groups) } },
        {
          provide: CensusService,
          useValue: { deletionsNoted: signal(0), seenDeleted: () => Promise.resolve(seenDeleted) },
        },
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

  /**
   * Deleted in Lightroom, which leaves a tombstone in the album and tells this app nothing: the
   * record and the verdict outlive the photograph, and it was offered as a blank row named by its id.
   */
  it('does not offer a photograph deleted in Lightroom', async () => {
    threeWaiting();
    seenDeleted.add('middle');

    await service.refresh();

    expect(service.all().map((p) => p.id)).toEqual(['oldest', 'newest']);
  });

  /**
   * A photograph the scan has not reached has no name on this device, and its row showed a 32-digit
   * asset id. The listing of the album knows what it is called.
   */
  it('names a photograph the scan has not reached from the album listing', async () => {
    threeWaiting();
    assets.delete('middle');
    const listing = [{ id: 'middle', payload: { importSource: { fileName: 'DSC_4390.NEF' } } }];
    TestBed.inject(EditAlbumNamesService).note(listing as PhotoAsset[]);

    await service.refresh();

    expect(service.all().find((p) => p.id === 'middle')?.name).toBe('DSC_4390');
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
   * A sweep is one photograph to the person editing it, so it is one row, placed by its longest-waiting
   * frame. A frame still waiting for room in the album belongs to that row, and the last frame of a
   * sweep is still a panorama: as a plain photo its "Done editing" would send it straight to print.
   */
  it('folds each sweep into one row, however many of its frames are left', async () => {
    const waiting = (id: string, at?: number): void => {
      verdicts.set(id, verdict('toEdit'));
      assets.set(id, meta(id));
      if (at !== undefined) records.set(id, filed(['KeeperEdit'], at));
    };
    waiting('a1', 100);
    waiting('a2', 50);
    waiting('a3'); // decided, but no room for it in the album yet
    waiting('solo', 75);
    waiting('b1', 200);
    verdicts.set('b2', verdict('toPrint')); // this frame of the other sweep has already left the queue
    groups = [
      { type: 'pano', sourceAlbumId: 'alb-1', memberIds: ['a1', 'a2', 'a3'] },
      { type: 'pano', sourceAlbumId: 'alb-1', memberIds: ['b1', 'b2'] },
    ];

    await service.refresh();

    expect(service.all().map((row) => [row.id, row.setFrameIds])).toEqual([
      ['a2', ['a1', 'a2', 'a3']],
      ['solo', undefined],
      ['b1', ['b1']],
    ]);
  });

  /**
   * A burst still grouped was sent to edit whole, which is how HDR brackets go, so it is one row and
   * "Done editing" looks for the merged file before anything can print. A burst settled in a duel
   * has had its group dissolved, so its survivors are alternatives and arrive here as single photos.
   */
  it('folds a burst sent to edit whole into one row, naming what kind of set it is', async () => {
    for (const [id, at] of [
      ['shot-1', 100],
      ['shot-2', 200],
    ] as const) {
      verdicts.set(id, verdict('toEdit'));
      assets.set(id, meta(id));
      records.set(id, filed(['KeeperEdit'], at));
    }
    groups = [{ type: 'burst', sourceAlbumId: 'alb-1', memberIds: ['shot-1', 'shot-2'] }];

    await service.refresh();

    expect(service.all().map((row) => [row.id, row.setKind, row.setFrameIds])).toEqual([
      ['shot-1', 'burst', ['shot-1', 'shot-2']],
    ]);
  });

  /**
   * The two eyes of a stereo pair are one shot to the person editing it, so they share a row, and
   * finishing one finishes both. The row has to say it is stereo, because no merged file is coming:
   * that kind is what stops "Done editing" going to look for one.
   */
  it('folds the two eyes of a stereo pair into one row', async () => {
    for (const [id, at] of [
      ['left', 100],
      ['right', 200],
    ] as const) {
      verdicts.set(id, verdict('toEdit'));
      assets.set(id, meta(id));
      records.set(id, filed(['KeeperEdit'], at));
    }
    groups = [{ type: 'stereo', sourceAlbumId: 'alb-1', memberIds: ['left', 'right'] }];

    await service.refresh();

    expect(service.all().map((row) => [row.id, row.setKind, row.setFrameIds])).toEqual([
      ['left', 'stereo', ['left', 'right']],
    ]);
  });

  /**
   * Which rows are stereo pairs depends on album names, and the catalogue is often read after the
   * first refresh. Nothing else would ask again until a photo left the queue, so a pair would sit on
   * two rows for no visible reason. Before the catalogue answers there is nothing new to read.
   */
  it('refreshes by itself once the catalogue has answered', async () => {
    threeWaiting();

    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
    expect(service.all()).toEqual([]);

    albumsChecked.set(true);
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));

    expect(service.all().map((p) => p.id)).toEqual(['oldest', 'middle', 'newest']);
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
