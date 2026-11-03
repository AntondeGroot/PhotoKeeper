import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { DetectedGroup } from '../../detection/detectors/detection-types';
import { PhotoAsset } from '../../lightroom-types';
import { LightroomService } from '../../lightroom.service';
import { AssetMeta, GroupMembers, StoredVerdict } from '../../storage/photokeeper-db';
import { AssetMetaStore } from '../../storage/review/asset-meta-store';
import { PhotoMergeStore } from '../../storage/review/photo-merge-store';
import { ReviewStore } from '../../storage/review/review-store';
import { GroupOverrideStore } from '../../storage/detection/group-override-store';
import { GroupStore } from '../../storage/detection/group-store';
import { MergeFinderService } from './merge-finder.service';

const file = (id: string, fileName: string): PhotoAsset => ({
  id,
  subtype: 'image',
  payload: { importSource: { fileName } },
});
const scanned = (name: string): AssetMeta => ({
  albumId: 'alb-1',
  name,
  ext: 'NEF',
  taken: '2026-05-01',
});
const toEdit: StoredVerdict = { status: 'toEdit', starred: false, saveOnly: false };

describe('MergeFinderService', () => {
  let service: MergeFinderService;
  let meta: Map<string, AssetMeta>;
  let album: PhotoAsset[];
  /** What the user has said a detected group really consists of. */
  let memberships: GroupMembers[];

  beforeEach(() => {
    meta = new Map([
      ['f1', scanned('DSC_1')],
      ['f2', scanned('DSC_2')],
    ]);
    album = [];
    memberships = [];
    const sweep: DetectedGroup = { type: 'pano', sourceAlbumId: 'alb-1', memberIds: ['f1', 'f2'] };

    TestBed.configureTestingModule({
      providers: [
        {
          provide: AssetMetaStore,
          useValue: {
            getAll: () => Promise.resolve(new Map(meta)),
            put: (id: string, value: AssetMeta) => {
              meta.set(id, value);
              return Promise.resolve();
            },
            delete: (id: string) => {
              meta.delete(id);
              return Promise.resolve();
            },
          },
        },
        {
          provide: ReviewStore,
          useValue: {
            getVerdicts: () =>
              Promise.resolve(
                new Map([
                  ['f1', toEdit],
                  ['f2', toEdit],
                ]),
              ),
          },
        },
        { provide: GroupStore, useValue: { getAll: () => Promise.resolve([sweep]) } },
        {
          provide: GroupOverrideStore,
          useValue: {
            getAll: () => Promise.resolve([]),
            reclassifications: () => Promise.resolve([]),
            memberships: () => Promise.resolve(memberships),
          },
        },
        { provide: PhotoMergeStore, useValue: { getAll: () => Promise.resolve(new Map()) } },
        {
          provide: LightroomService,
          useValue: {
            getAllAlbumAssets: (albumId: string) => of(albumId === 'alb-1' ? album : []),
          },
        },
      ],
    });
    service = TestBed.inject(MergeFinderService);
  });

  /**
   * Tapping "Done editing" must not depend on the scan having got there: until it has, this device
   * has never heard of the merged file. Only what recognising it needs is stored, so this search
   * cannot bring the album's other unscanned photographs onto the deck ahead of the scan.
   */
  it('finds a merged file the scan has not reached, and stores only that', async () => {
    album = [
      file('f1', 'DSC_1.NEF'),
      file('f2', 'DSC_2.NEF'),
      file('m1', 'DSC_1-Pano.dng'),
      file('other', 'DSC_9.NEF'),
    ];

    const found = await service.searchFor(['f1', 'f2']);

    expect(found).toEqual([
      { mergedId: 'm1', mergedName: 'DSC_1-Pano', kind: 'panorama', frameIds: ['f1', 'f2'] },
    ]);
    expect(meta.get('m1')).toMatchObject({ albumId: 'alb-1', name: 'DSC_1-Pano', ext: 'dng' });
    expect(meta.has('other')).toBe(false);
  });

  /**
   * Deleting a photo leaves a tombstone in its album, under a new id and with the same filename. Read
   * as a merge it would be confirmed and sent to print, while the frames were stood down for good.
   */
  it('does not take the tombstone of a deleted merged file for a merge', async () => {
    album = [
      file('f1', 'DSC_1.NEF'),
      file('f2', 'DSC_2.NEF'),
      { ...file('gone', 'DSC_1-Pano.dng'), subtype: 'deleted_image', original: { id: 'm1' } },
    ];

    const found = await service.searchFor(['f1', 'f2']);

    expect(found).toEqual([]);
    expect(meta.has('gone')).toBe(false);
  });

  /**
   * The record outlives the file until the album's next scan, and confirming a merged file that no
   * longer exists would leave nothing to print while the frames were stood down. An ordinary deleted
   * photograph stays for the scan to deal with, so only merges are affected here.
   */
  it('forgets a merged file the scan knew about once it has been deleted', async () => {
    meta.set('m1', scanned('DSC_1-Pano'));
    meta.set('plain', scanned('DSC_7'));
    const tombstone = (id: string, fileName: string, original: string): PhotoAsset => ({
      ...file(id, fileName),
      subtype: 'deleted_image',
      original: { id: original },
    });
    album = [
      file('f1', 'DSC_1.NEF'),
      file('f2', 'DSC_2.NEF'),
      tombstone('gone', 'DSC_1-Pano.dng', 'm1'),
      tombstone('gone-too', 'DSC_7.NEF', 'plain'),
    ];

    const found = await service.searchFor(['f1', 'f2']);

    expect(found).toEqual([]);
    expect(meta.has('m1')).toBe(false);
    expect(meta.has('plain')).toBe(true);
  });

  /**
   * A frame the user added to a sweep by hand is part of that panorama, and only the correction says
   * so. Going by detection alone would leave it in the queue after the panorama was confirmed, as a
   * photograph of its own still asking to be edited.
   */
  it('counts a frame added by hand among those a merged file was made from', async () => {
    meta.set('f3', scanned('DSC_3'));
    memberships = [{ memberIds: ['f1', 'f2'], frameIds: ['f1', 'f2', 'f3'], at: 0 }];
    album = [file('m1', 'DSC_1-Pano.dng')];

    const found = await service.searchFor(['f1', 'f2', 'f3']);

    expect(found).toMatchObject([{ mergedId: 'm1', frameIds: ['f1', 'f2', 'f3'] }]);
  });

  /**
   * The filename is the only link, so a merged file named after a frame this device has no record of
   * would match nothing and read as "not there". That frame is stored too, because the link cannot
   * be made without it, while the album's other unscanned photographs still wait for the scan.
   */
  it('stores the unscanned frame a merged file is named after, and links through it', async () => {
    memberships = [{ memberIds: ['f1', 'f2'], frameIds: ['src', 'f1', 'f2'], at: 0 }];
    album = [file('src', 'DSC_0.NEF'), file('m1', 'DSC_0-Pano.dng'), file('other', 'DSC_9.NEF')];

    const found = await service.searchFor(['src', 'f1', 'f2']);

    expect(found).toMatchObject([{ mergedId: 'm1', frameIds: ['src', 'f1', 'f2'] }]);
    expect(meta.get('src')).toMatchObject({ albumId: 'alb-1', name: 'DSC_0', ext: 'NEF' });
    expect(meta.has('other')).toBe(false);
  });
});
