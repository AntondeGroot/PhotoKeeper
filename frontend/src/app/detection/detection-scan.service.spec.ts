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
import { EdgeHash } from '../storage/photokeeper-db';

const image = (id: string, captureDate: string, updated = 'v1'): PhotoAsset => ({
  id,
  subtype: 'image',
  updated,
  payload: { captureDate },
});

// Each asset gets a blob of a unique byte length; the stub hasher maps that length → a chosen hash.
// Using blob *size* (not content) keeps the mapping stable through a fake-indexeddb round-trip.
const SIZE_OF: Record<string, number> = { a1: 1, a2: 2, a3: 3, a4: 4, p1: 5, p2: 6, p3: 7 };
const HASH_BY_SIZE: Record<number, string> = {
  1: '0000000000000000',
  2: '0000000000000001', // hamming 1 from a1 → near-duplicate
  3: 'ffffffffffffffff', // far from both → its own single
  4: '0000000000000003',
  // p1..p3: whole-frame hashes far apart, so they are NOT a burst (only a pano via edges).
  5: '0f0f0f0f0f0f0f0f',
  6: 'f0f0f0f0f0f0f0f0',
  7: '00ff00ff00ff00ff',
};
// Edge hashes (four strips: left/right for a horizontal pan, top/bottom for vertical). a-frames don't
// overlap; p1→p2→p3 chain horizontally (right of one === left of the next), with top/bottom pinned
// far apart so the run locks to 'horizontal'.
const FAR = 'ffffffffffffffff';
const NEAR = '0000000000000000';
const NO_OVERLAP: EdgeHash = { left: NEAR, right: FAR, top: NEAR, bottom: FAR };
const hEdge = (left: string, right: string): EdgeHash => ({ left, right, top: NEAR, bottom: FAR });
const EDGE_BY_SIZE: Record<number, EdgeHash> = {
  1: NO_OVERLAP,
  2: NO_OVERLAP,
  3: NO_OVERLAP,
  4: NO_OVERLAP,
  5: hEdge('1111111111111111', '2222222222222222'),
  6: hEdge('2222222222222222', '3333333333333333'),
  7: hEdge('3333333333333333', '4444444444444444'),
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
    localStorage.clear(); // detection settings default; tests assume the 3s window / hamming 10
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
    const hasherStub = {
      hash: (blob: Blob) => Promise.resolve(HASH_BY_SIZE[blob.size]),
      edgeHash: (blob: Blob) => Promise.resolve(EDGE_BY_SIZE[blob.size]),
    };

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

  it('hashes only the burst candidates (not lone photos) and stores the detected burst', async () => {
    const report = await service.scanAlbum('alb-1');

    // a1+a2 are a time-cluster candidate → hashed; a3 is a lone photo → metadata only, never hashed.
    expect(report).toEqual({ albumId: 'alb-1', skipped: false, hashed: 2, removed: 0, groups: 1 });
    expect([...(await hashStore.getAll()).keys()].sort((x, y) => x.localeCompare(y))).toEqual([
      'a1',
      'a2',
    ]);
    expect(await groupStore.getByAlbum('alb-1')).toEqual([
      { type: 'burst', sourceAlbumId: 'alb-1', memberIds: ['a1', 'a2'] },
    ]);
    // Metadata is stored for every image, including the un-hashed lone photo.
    expect(await metaStore.get('a3')).toEqual({
      albumId: 'alb-1',
      name: 'a3',
      taken: '2026-05-01T12:00:00Z',
    });
    expect(await hashStore.get('a3')).toBeUndefined();
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

    // Only burst candidates a1/a2 are hashed; a1 comes from the warmed preview, so only a2 is fetched.
    expect(fetched).toEqual(['a2']);
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

  it('detects a pano from edge-overlapping frames whose whole-frame hashes differ', async () => {
    // p1→p2→p3 pan: each frame's right edge matches the next frame's left edge, but their
    // whole-frame hashes are far apart, so this is a pano, not a burst.
    albumAssets = [
      image('p1', '2026-05-02T10:00:00Z'),
      image('p2', '2026-05-02T10:00:02Z'),
      image('p3', '2026-05-02T10:00:04Z'),
    ];

    const report = await service.scanAlbum('alb-2');

    expect(report.groups).toBe(1);
    expect(await groupStore.getByAlbum('alb-2')).toEqual([
      {
        type: 'pano',
        sourceAlbumId: 'alb-2',
        memberIds: ['p1', 'p2', 'p3'],
        orientation: 'horizontal',
      },
    ]);
  });
});
