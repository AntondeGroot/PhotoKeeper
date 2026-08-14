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

  it('shows the fill level once it falls two batches behind, and hides it only when full', async () => {
    await service.refill(); // a full queue: nothing to say
    expect(service.fillPercent()).toBe(100);
    expect(service.low()).toBe(false);

    // One batch taken. The refill that follows puts it straight back, so saying anything here
    // would just blink through every ordinary session.
    await service.take(15);
    expect(service.low()).toBe(false);
    expect(service.fillPercent()).toBe(93);

    // A second batch without a refill in between: now it is genuinely falling behind.
    await service.take(15);
    expect(service.low()).toBe(true);
    expect(service.fillPercent()).toBe(85);

    // Sticky on the way back: a partial refill is still catching up, so it keeps reporting.
    await service.take(1);
    expect(service.low()).toBe(true);

    await service.refill(); // back to full
    expect(service.fillPercent()).toBe(100);
    expect(service.low()).toBe(false);
  });

  it('stands the indicator down when the library is out of photos, rather than reporting a gap that will never close', async () => {
    // Forty photos in the whole catalog, all unseen: the queue takes every one of them and is still
    // far short of its two hundred.
    library = Array.from({ length: 40 }, (_, i) => photo(`s${i}`));
    await service.refill();
    expect(service.available()).toBe(40);

    // Short of target, but not *behind* — there is nothing left to fetch and nothing the user could
    // do about it. Reporting "buffer 20%" here would be a permanent complaint about a finished job.
    expect(service.low()).toBe(false);

    // The distinction is whether more exists. Give the catalog room to grow and take enough to fall
    // two batches behind, and it reports again.
    library = Array.from({ length: 500 }, (_, i) => photo(`s${i}`));
    await service.refill();
    expect(service.fillPercent()).toBe(100);
    await service.take(15);
    await service.take(15);
    expect(service.low()).toBe(true);
  });
});
