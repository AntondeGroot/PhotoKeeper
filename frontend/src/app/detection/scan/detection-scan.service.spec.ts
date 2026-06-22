import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { DetectionScanService } from './detection-scan.service';
import { ImageHasher } from '../detectors/image-hasher';
import { LightroomService } from '../../lightroom.service';
import { PhotoAsset } from '../../lightroom-types';
import { HashStore } from '../../storage/detection/hash-store';
import { GroupStore } from '../../storage/detection/group-store';
import { PreviewStore } from '../../storage/review/preview-store';
import { AssetMetaStore } from '../../storage/review/asset-meta-store';
import { FrameSignature } from '../detectors/detection-types';
import { SIGNATURE_SIZE } from '../detectors/phash';

const image = (id: string, captureDate: string, updated = 'v1'): PhotoAsset => ({
  id,
  subtype: 'image',
  updated,
  payload: { captureDate },
});

// Each asset gets a blob of a unique byte length; the stub hasher maps that length → a chosen hash +
// signature. Using blob *size* (not content) keeps the mapping stable through a fake-indexeddb round-trip.
const SIZE_OF: Record<string, number> = { a1: 1, a2: 2, a3: 3, a4: 4, p1: 5, p2: 6, p3: 7 };
const HASH_BY_SIZE: Record<number, string> = {
  1: '0000000000000000',
  2: '0000000000000001', // hamming 1 from a1 → near-duplicate
  3: 'ffffffffffffffff', // far from both → its own single
  4: '0000000000000003',
  // p1..p3: whole-frame hashes far apart, so they are distinct enough to be a pan, not a burst.
  5: '0f0f0f0f0f0f0f0f',
  6: 'f0f0f0f0f0f0f0f0',
  7: '00ff00ff00ff00ff',
};

// A 1-D "scene" sampled into a 64×64 grayscale signature: column c of a frame starting at scene
// position `startX` shows scene column startX+c, with row-dependent texture so mean-subtracted lines
// carry signal. Frames 32 columns apart overlap by 32 (50%) — a clean horizontal pan.
const N = SIGNATURE_SIZE;
// Deterministic, non-periodic pseudo-random scene so non-overlapping positions don't coincidentally match.
const sceneValue = (x: number, r: number): number => {
  let h = (Math.imul(x + 1, 374761393) + Math.imul(r + 1, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) & 0xff;
};
const horizFrame = (startX: number): FrameSignature => {
  const grid = new Uint8Array(N * N);
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++) grid[r * N + c] = sceneValue(startX + c, r);
  return grid;
};
const flat: FrameSignature = new Uint8Array(N * N).fill(128); // a-frames: no structure to overlap
const SIGNATURE_BY_SIZE: Record<number, FrameSignature> = {
  1: flat,
  2: flat,
  3: flat,
  4: flat,
  5: horizFrame(0),
  6: horizFrame(32), // left 32 cols === p1's right 32 → overlap
  7: horizFrame(64), // left 32 cols === p2's right 32 → overlap
};
const blobFor = (id: string) => new Blob(['x'.repeat(SIZE_OF[id])]);

// A budget comfortably larger than the test albums, so each scan covers the whole album in one pass.
const BUDGET = 100;

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
      signature: (blob: Blob) => Promise.resolve(SIGNATURE_BY_SIZE[blob.size]),
      aspect: () => Promise.resolve(1.5), // same for every frame → aspect gate never rejects
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
    const report = await service.scanAlbum('alb-1', BUDGET);

    // a1+a2 are a time-cluster candidate → hashed; a3 is a lone photo → metadata only, never hashed.
    expect(report).toEqual({
      albumId: 'alb-1',
      skipped: false,
      hashed: 2,
      removed: 0,
      groups: 1,
      scanned: 3, // all three images covered this pass (budget ≫ album)
      exhausted: true,
    });
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
    await service.scanAlbum('alb-1', BUDGET);
    fetched.length = 0;

    const report = await service.scanAlbum('alb-1', BUDGET);

    expect(report.skipped).toBe(true);
    expect(fetched).toEqual([]);
  });

  it('reuses a warmed 2048 preview instead of fetching a rendition', async () => {
    await previewStore.put('a1', '2048', blobFor('a1'));

    await service.scanAlbum('alb-1', BUDGET);

    // Only burst candidates a1/a2 are hashed; a1 comes from the warmed preview, so only a2 is fetched.
    expect(fetched).toEqual(['a2']);
  });

  it('re-hashes edited assets, fetches added ones, and drops removed hashes', async () => {
    await service.scanAlbum('alb-1', BUDGET);
    fetched.length = 0;

    // a1 unchanged, a2 edited (new revision), a3 removed, a4 added.
    albumAssets = [
      image('a1', '2026-05-01T10:00:00Z'),
      image('a2', '2026-05-01T10:00:02Z', 'v2'),
      image('a4', '2026-05-01T10:00:03Z'),
    ];

    const report = await service.scanAlbum('alb-1', BUDGET);

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

  it('caps a pass at the budget and resumes from the cursor on the next pass', async () => {
    // Four lone photos an hour apart — no groups, so the budget bites cleanly at each boundary.
    albumAssets = [
      image('a1', '2026-05-01T10:00:00Z'),
      image('a2', '2026-05-01T11:00:00Z'),
      image('a3', '2026-05-01T12:00:00Z'),
      image('a4', '2026-05-01T13:00:00Z'),
    ];

    const first = await service.scanAlbum('alb-1', 2);
    expect(first.scanned).toBe(2);
    expect(first.exhausted).toBe(false);
    expect([...(await metaStore.getAll()).keys()].sort((x, y) => x.localeCompare(y))).toEqual([
      'a1',
      'a2',
    ]);

    const second = await service.scanAlbum('alb-1', 2);
    expect(second.scanned).toBe(2);
    expect(second.exhausted).toBe(true);
    expect([...(await metaStore.getAll()).keys()].sort((x, y) => x.localeCompare(y))).toEqual([
      'a1',
      'a2',
      'a3',
      'a4',
    ]);
  });

  it('overshoots the budget to finish a burst straddling the cap (soft max + peek)', async () => {
    // a1 lone; a2/a3/a4 are a 1-second-apart run an hour later. A budget of 2 would stop after a1,a2 —
    // but a2 opens a time-run, so the window keeps going through a3,a4 and peeks one past to confirm.
    albumAssets = [
      image('a1', '2026-05-01T10:00:00Z'),
      image('a2', '2026-05-01T11:00:00Z'),
      image('a3', '2026-05-01T11:00:01Z'),
      image('a4', '2026-05-01T11:00:02Z'),
    ];

    const report = await service.scanAlbum('alb-1', 2);

    expect(report.scanned).toBe(4); // finished the run rather than cutting it at the budget
    expect(report.exhausted).toBe(true);
  });

  it('detects a pano from overlapping frames whose whole-frame hashes differ', async () => {
    // p1→p2→p3 pan: each frame's right half overlaps the next frame's left half (the slide-matcher
    // finds it), but their whole-frame hashes are far apart, so this is a pano, not a burst.
    albumAssets = [
      image('p1', '2026-05-02T10:00:00Z'),
      image('p2', '2026-05-02T10:00:02Z'),
      image('p3', '2026-05-02T10:00:04Z'),
    ];

    const report = await service.scanAlbum('alb-2', BUDGET);

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
