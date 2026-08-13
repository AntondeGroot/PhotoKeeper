import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { TestBed } from '@angular/core/testing';
import { ReviewBufferService } from './review-buffer.service';
import { DailyUnitsService } from './selection/daily-units.service';
import { PreviewCacheService } from './preview-cache.service';
import { ReviewStore } from '../storage/review/review-store';
import { Photo, ReviewItem } from '../photo';

const photo = (id: string): Photo => ({
  id,
  name: id,
  album: null,
  taken: '2026-01-01',
  status: 'backlog',
  kind: 'photo',
  starred: false,
  keepsake: false,
});

describe('ReviewBufferService', () => {
  let service: ReviewBufferService;
  let reviews: ReviewStore;
  let library: ReviewItem[];
  let warmed: string[];

  beforeEach(() => {
    indexedDB = new IDBFactory();
    localStorage.clear();
    library = Array.from({ length: 500 }, (_, i) => photo(`p${i}`));
    warmed = [];

    TestBed.configureTestingModule({
      providers: [
        {
          // Stands in for the sampler: hands back the library, which the service then filters.
          provide: DailyUnitsService,
          useValue: {
            buildUnits: (_v: readonly string[], limit: number) =>
              Promise.resolve(library.slice(0, limit)),
          },
        },
        {
          provide: PreviewCacheService,
          useValue: {
            warmDurable: (id: string) => {
              warmed.push(id);
              return Promise.resolve();
            },
          },
        },
      ],
    });
    service = TestBed.inject(ReviewBufferService);
    reviews = TestBed.inject(ReviewStore);
  });

  it('hands back a full batch off the front, however much of the library is already reviewed', async () => {
    // 480 of 500 decided — the state that made sampling on demand return two or three photos.
    for (let i = 0; i < 480; i++) {
      await reviews.setVerdict(`p${i}`, { status: 'kept', starred: false, keepsake: false });
    }
    await service.refill();

    // The search happened in the background, so this is a slice: a full batch, not what a draw
    // happened to turn up.
    const batch = await service.take(15);
    expect(batch.length).toBe(15);
    expect(batch.every((u) => Number(u.id.slice(1)) >= 480)).toBe(true); // all genuinely unseen

    // Only the front was downloaded. Warming all twenty queued — let alone a full two hundred —
    // would be a lot of data for photos that may not be looked at for weeks.
    expect(warmed).toEqual(batch.map((u) => u.id));
  });
});
