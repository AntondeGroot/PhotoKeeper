import { TestBed } from '@angular/core/testing';
import { PanoFramesService } from './pano-frames.service';
import { AssetMetaStore } from '../storage/review/asset-meta-store';
import { GroupStore } from '../storage/detection/group-store';
import { DetectedGroup } from '../detection/detectors/detection-types';
import { AssetMeta } from '../storage/photokeeper-db';
import { Pano } from '../photo';

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

function pano(frameIds: string[]): Pano {
  return {
    id: 'pano1',
    name: 'Panorama',
    album: 'Peaks',
    taken: '2026-05-24',
    status: 'backlog',
    kind: 'pano',
    orientation: 'horizontal',
    frames: frameIds.map((id) => ({ id, name: id })),
  };
}

describe('PanoFramesService', () => {
  let service: PanoFramesService;
  let groups: DetectedGroup[];

  beforeEach(() => {
    groups = [];
    TestBed.configureTestingModule({
      providers: [
        { provide: AssetMetaStore, useValue: { getAll: () => Promise.resolve(INDEX) } },
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
    const candidates = await service.candidatesFor(pano(['p2']));

    expect(candidates.map((c) => c.id)).toEqual(['p1', 'p2', 'p3']);
  });

  it('stays inside the album the frames came out of', async () => {
    // The pano's own `album` is a display name and several albums can share one; the frames say
    // exactly which album they were shot in.
    const candidates = await service.candidatesFor(pano(['p2']));

    expect(candidates.map((c) => c.id)).not.toContain('c1');
  });

  it('marks the frames of a sibling group, so a split sweep can be merged whole', async () => {
    groups = [
      { type: 'pano', sourceAlbumId: 'peaks', memberIds: ['p1'] }, // the pano being corrected
      { type: 'pano', sourceAlbumId: 'peaks', memberIds: ['p2', 'p3'] }, // the other half
    ];

    const candidates = await service.candidatesFor(pano(['p1']));

    expect(candidates.filter((c) => c.inOtherGroup).map((c) => c.id)).toEqual(['p2', 'p3']);
  });

  it('offers nothing when the frames have not been scanned onto this device', async () => {
    expect(await service.candidatesFor(pano(['unscanned']))).toEqual([]);
  });
});
