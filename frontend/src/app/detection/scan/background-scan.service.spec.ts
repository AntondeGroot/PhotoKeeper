import { TestBed } from '@angular/core/testing';
import { BackgroundScanService } from './background-scan.service';
import { ReviewBufferService } from '../../review/review-buffer.service';
import { REVIEW_BUFFER_TARGET } from '../../review/review-buffer-target';
import { CatalogScanService } from './catalog-scan.service';
import { AssetMetaStore } from '../../storage/review/asset-meta-store';
import { ReviewStore } from '../../storage/review/review-store';
import { AssetMeta, StoredVerdict } from '../../storage/photokeeper-db';

describe('BackgroundScanService', () => {
  let service: BackgroundScanService;
  let scanBudgets: number[];
  let meta: Map<string, AssetMeta>;
  let verdicts: Map<string, StoredVerdict>;
  let bufferUnits: number;

  const authed = () => true;
  const notAuthed = () => false;

  beforeEach(() => {
    scanBudgets = [];
    meta = new Map();
    verdicts = new Map();
    bufferUnits = 0;
    TestBed.configureTestingModule({
      providers: [
        {
          provide: CatalogScanService,
          useValue: {
            scanAllAlbums: (budget: number) => {
              scanBudgets.push(budget);
              return Promise.resolve();
            },
          },
        },
        { provide: AssetMetaStore, useValue: { getAll: () => Promise.resolve(meta) } },
        { provide: ReviewStore, useValue: { getVerdicts: () => Promise.resolve(verdicts) } },
        { provide: ReviewBufferService, useValue: { available: () => bufferUnits } },
      ],
    });
    service = TestBed.inject(BackgroundScanService);
  });

  it('does nothing when not authenticated', async () => {
    meta.set('a', {} as AssetMeta); // a deficit exists, but no session
    await service.run(notAuthed);
    expect(scanBudgets).toEqual([]);
  });

  it('scans the deficit (target minus un-reviewed) when authenticated', async () => {
    for (let i = 0; i < 30; i++) meta.set(`a${i}`, {} as AssetMeta); // 30 scanned
    verdicts.set('a0', {} as StoredVerdict); // 1 reviewed → 29 un-reviewed
    await service.run(authed);
    // Nothing queued yet, so there is no ratio to measure: one image per unit is assumed and the
    // target is the queue's own target.
    expect(scanBudgets).toEqual([REVIEW_BUFFER_TARGET - 29]);
  });

  it('skips the scan when the buffer is already full (deficit ≤ 0)', async () => {
    const over = REVIEW_BUFFER_TARGET + 20;
    for (let i = 0; i < over; i++) meta.set(`a${i}`, {} as AssetMeta); // un-reviewed > target
    await service.run(authed);
    expect(scanBudgets).toEqual([]); // budget 0 → no scan
  });

  it('scans further ahead when the catalog yields fewer units per image than it does photos', async () => {
    // The state that pinned the queue at 45%: 300 unreviewed images that only build 90 units,
    // because bursts, panoramas and Lightroom edits each arrive as one unit made of several images.
    for (let i = 0; i < 300; i++) meta.set(`a${i}`, {} as AssetMeta);
    bufferUnits = 90;

    await service.run(authed);

    // ~3.33 images per unit, so filling 200 units needs ~667 images — 367 more than are on hand.
    // A fixed multiplier could not know that; it is a property of somebody's photos, not a constant.
    expect(scanBudgets).toEqual([367]);
  });

  it('caps how far ahead it will work, so a bad measurement cannot run away', async () => {
    // One enormous burst: 200 images, a single unit. Taken literally that asks for 40,000 images.
    for (let i = 0; i < 200; i++) meta.set(`a${i}`, {} as AssetMeta);
    bufferUnits = 1;

    await service.run(authed);

    expect(scanBudgets).toEqual([REVIEW_BUFFER_TARGET * 4 - 200]);
  });
});
