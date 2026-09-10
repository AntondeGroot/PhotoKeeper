import { TestBed } from '@angular/core/testing';
import { PanoFramesService } from './pano-frames.service';
import { AssetMetaStore } from '../storage/review/asset-meta-store';
import { ReviewStore } from '../storage/review/review-store';
import { AssetMeta, StoredVerdict } from '../storage/photokeeper-db';
import { GroupStore } from '../storage/detection/group-store';
import { DetectedGroup } from '../detection/detectors/detection-types';

function meta(albumId: string, name: string, taken: string): AssetMeta {
  return { albumId, name, ext: 'NEF', taken };
}

/** Two albums shot the same morning, so an album mix-up would be visible in the window. */
const INDEX = new Map<string, AssetMeta>([
  ['p1', meta('peaks', 'DSC_1', '2026-05-24T10:00:01')],
  ['p2', meta('peaks', 'DSC_2', '2026-05-24T10:00:02')],
  ['p3', meta('peaks', 'DSC_3', '2026-05-24T10:00:03')],
  ['c1', meta('coast', 'IMG_1', '2026-05-24T10:00:01')],
]);

describe('PanoFramesService', () => {
  let service: PanoFramesService;
  let groups: DetectedGroup[];
  /** What has already been said about each photo; anything decided is not on offer. */
  let verdicts: Map<string, StoredVerdict>;

  beforeEach(() => {
    groups = [];
    verdicts = new Map();
    TestBed.configureTestingModule({
      providers: [
        { provide: AssetMetaStore, useValue: { getAll: () => Promise.resolve(INDEX) } },
        { provide: ReviewStore, useValue: { getVerdicts: () => Promise.resolve(verdicts) } },
        {
          provide: GroupStore,
          useValue: {
            getByAlbum: (albumId: string) =>
              Promise.resolve(groups.filter((g) => g.sourceAlbumId === albumId)),
          },
        },
      ],
    });
    service = TestBed.inject(PanoFramesService);
  });

  it('offers the pano frames and their neighbours, in capture order', async () => {
    const candidates = await service.candidatesFor(['p2']);

    expect(candidates.map((c) => c.id)).toEqual(['p1', 'p2', 'p3']);
  });

  it('stays inside the album the frames came out of', async () => {
    // The pano's own `album` is a display name and several albums can share one; the frames say
    // exactly which album they were shot in.
    const candidates = await service.candidatesFor(['p2']);

    expect(candidates.map((c) => c.id)).not.toContain('c1');
  });

  it('marks the frames of a sibling group, so a split sweep can be merged whole', async () => {
    groups = [
      { type: 'pano', sourceAlbumId: 'peaks', memberIds: ['p1'] }, // the pano being corrected
      { type: 'pano', sourceAlbumId: 'peaks', memberIds: ['p2', 'p3'] }, // the other half
    ];

    const candidates = await service.candidatesFor(['p1']);

    expect(candidates.filter((c) => c.inOtherGroup).map((c) => c.id)).toEqual(['p2', 'p3']);
  });

  it('offers nothing when the frames have not been scanned onto this device', async () => {
    expect(await service.candidatesFor(['unscanned'])).toEqual([]);
  });
  /**
   * A photograph that has already been answered for is not on offer. Rejected ones especially: by
   * the time this is asked they are very likely deleted in Lightroom, so the panorama would be
   * assembled out of photographs that no longer exist — and any decided one re-opens, quietly and
   * from the wrong screen, a decision the user made deliberately somewhere else.
   */
  describe('what is on offer', () => {
    const decided = (status: StoredVerdict['status']): StoredVerdict => ({
      status,
      starred: false,
      saveOnly: false,
    });

    it('leaves out a neighbour that has already been decided', async () => {
      verdicts.set('p1', decided('rejected'));

      const offered = (await service.candidatesFor(['p2'])).map((c) => c.id);

      expect(offered).toEqual(['p2', 'p3']);
    });

    it('leaves out every kind of decision, not only rejection', async () => {
      verdicts.set('p1', decided('kept'));
      verdicts.set('p3', decided('toEdit'));

      expect((await service.candidatesFor(['p2'])).map((c) => c.id)).toEqual(['p2']);
    });

    /** The frames themselves stay, whatever has been said about them — they are what is being fixed. */
    it('keeps the frames it was asked about', async () => {
      verdicts.set('p2', decided('kept'));

      expect((await service.candidatesFor(['p2'])).map((c) => c.id)).toContain('p2');
    });

    it('offers everything when nothing has been decided', async () => {
      expect((await service.candidatesFor(['p2'])).map((c) => c.id)).toEqual(['p1', 'p2', 'p3']);
    });
  });
});
