import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { DetectionScanService } from './detection-scan.service';
import { ImageHasher } from './image-hasher';
import { LightroomService, PhotoAsset } from '../lightroom.service';
import { HashStore } from '../storage/hash-store';
import { GroupStore } from '../storage/group-store';
import { PreviewStore } from '../storage/preview-store';
import { AssetMetaStore } from '../storage/asset-meta-store';

const image = (id: string, captureDate: string, updated = 'v1'): PhotoAsset => ({
  id,
  subtype: 'image',
  updated,
  payload: { captureDate },
});

// Each asset gets a blob of a unique byte length; the stub hasher maps that length → a chosen hash.
// Using blob *size* (not content) keeps the mapping stable through a fake-indexeddb round-trip.
const SIZE_OF: Record<string, number> = { a1: 1, a2: 2, a3: 3, a4: 4 };
const HASH_BY_SIZE: Record<number, string> = {
  1: '0000000000000000',
  2: '0000000000000001', // hamming 1 from a1 → near-duplicate
  3: 'ffffffffffffffff', // far from both → its own single
  4: '0000000000000003',
};
const blobFor = (id: string) => new Blob(['x'.repeat(SIZE_OF[id])]);

describe('DetectionScanService', () => {
  let service: DetectionScanService;
  let hashStore: HashStore;
  let groupStore: GroupStore;
  let previewStore: PreviewStore;
  let metaStore: AssetMetaStore;
  let fetched: string[];
  let albumAssets: PhotoAsset[];

  beforeEach(() => {
    indexedDB = new IDBFactory(); // fresh, empty database per test
    fetched = [];
    albumAssets = [
      image('a1', '2026-05-01T10:00:00Z'),
      image('a2', '2026-05-01T10:00:02Z'), // 2s after a1, inside the 3s burst window
      image('a3', '2026-05-01T12:00:00Z'), // hours later → not part of the burst
    ];

    const svcStub = {
      getAllAlbumAssets: () => of(albumAssets),
      getPhotoBlob: (id: string) => {
        fetched.push(id);
        return of(blobFor(id));
      },
    };
    const hasherStub = { hash: (blob: Blob) => Promise.resolve(HASH_BY_SIZE[blob.size]) };

    TestBed.configureTestingModule({
      providers: [
        { provide: LightroomService, useValue: svcStub },
        { provide: ImageHasher, useValue: hasherStub },
      ],
    });
    service = TestBed.inject(DetectionScanService);
    hashStore = TestBed.inject(HashStore);
    groupStore = TestBed.inject(GroupStore);
    previewStore = TestBed.inject(PreviewStore);
    metaStore = TestBed.inject(AssetMetaStore);
  });

  it('hashes every asset and stores the detected burst on the first scan', async () => {
    const report = await service.scanAlbum('alb-1');

    expect(report).toEqual({ albumId: 'alb-1', skipped: false, hashed: 3, removed: 0, groups: 1 });
    expect((await hashStore.getAll()).size).toBe(3);
    expect(await groupStore.getByAlbum('alb-1')).toEqual([
      { type: 'burst', sourceAlbumId: 'alb-1', memberIds: ['a1', 'a2'] },
    ]);
    expect(await metaStore.get('a1')).toEqual({
      albumId: 'alb-1',
      name: 'a1',
      taken: '2026-05-01T10:00:00Z',
    });
  });

  it('skips an unchanged album on the second scan — no fetch, no re-hash', async () => {
    await service.scanAlbum('alb-1');
    fetched.length = 0;

    const report = await service.scanAlbum('alb-1');

    expect(report.skipped).toBe(true);
    expect(fetched).toEqual([]);
  });

  it('reuses a warmed 2048 preview instead of fetching a rendition', async () => {
    await previewStore.put('a1', '2048', blobFor('a1'));

    await service.scanAlbum('alb-1');

    expect(fetched).toEqual(['a2', 'a3']); // a1 came from the warmed preview
  });

  it('re-hashes edited assets, fetches added ones, and drops removed hashes', async () => {
    await service.scanAlbum('alb-1');
    fetched.length = 0;

    // a1 unchanged, a2 edited (new revision), a3 removed, a4 added.
    albumAssets = [
      image('a1', '2026-05-01T10:00:00Z'),
      image('a2', '2026-05-01T10:00:02Z', 'v2'),
      image('a4', '2026-05-01T10:00:03Z'),
    ];

    const report = await service.scanAlbum('alb-1');

    expect([...fetched].sort((x, y) => x.localeCompare(y))).toEqual(['a2', 'a4']); // a1 keeps its hash
    expect(report.removed).toBe(1);
    expect((await hashStore.getAll()).has('a3')).toBe(false);
    expect(await metaStore.get('a3')).toBeUndefined(); // removed asset's metadata dropped too
    expect(await metaStore.get('a4')).toEqual({
      albumId: 'alb-1',
      name: 'a4',
      taken: '2026-05-01T10:00:03Z',
    });
  });
});
