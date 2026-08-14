import { TestBed } from '@angular/core/testing';
import { BackgroundScanService, SCAN_BUFFER_TARGET } from './background-scan.service';
import { CatalogScanService } from './catalog-scan.service';
import { AssetMetaStore } from '../../storage/review/asset-meta-store';
import { ReviewStore } from '../../storage/review/review-store';
import { AssetMeta, StoredVerdict } from '../../storage/photokeeper-db';

describe('BackgroundScanService', () => {
  let service: BackgroundScanService;
  let scanBudgets: number[];
  let meta: Map<string, AssetMeta>;
  let verdicts: Map<string, StoredVerdict>;

  const authed = () => true;
  const notAuthed = () => false;

  beforeEach(() => {
    scanBudgets = [];
    meta = new Map();
    verdicts = new Map();
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
    expect(scanBudgets).toEqual([SCAN_BUFFER_TARGET - 29]);
  });

  it('skips the scan when the buffer is already full (deficit ≤ 0)', async () => {
    const over = SCAN_BUFFER_TARGET + 20;
    for (let i = 0; i < over; i++) meta.set(`a${i}`, {} as AssetMeta); // un-reviewed > target
    await service.run(authed);
    expect(scanBudgets).toEqual([]); // budget 0 → no scan
  });
});
