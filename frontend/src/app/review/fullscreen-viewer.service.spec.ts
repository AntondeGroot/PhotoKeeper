import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { SafeUrl } from '@angular/platform-browser';
import { FullscreenViewerService } from './fullscreen-viewer.service';
import { ReviewFeedService } from './review-feed.service';
import { PreviewCacheService } from './preview-cache.service';
import { ReviewDecisionsService } from './review-decisions.service';
import { Burst, Photo, ReviewItem } from '../photo';

const photo = (id: string, status: Photo['status'] = 'backlog'): Photo => ({
  id,
  name: id,
  album: null,
  taken: '2026-01-01',
  status,
  kind: 'photo',
  starred: false,
  keepsake: false,
});

const burst = (id: string, frameIds: string[]): Burst => ({
  id,
  name: id,
  album: null,
  taken: '2026-01-01',
  status: 'backlog',
  kind: 'burst',
  photos: frameIds.map((fid) => ({ id: fid, name: fid })),
});

describe('FullscreenViewerService', () => {
  let service: FullscreenViewerService;
  let photos: ReturnType<typeof signal<ReviewItem[]>>;
  let index: ReturnType<typeof signal<number>>;
  let decided: string[];

  beforeEach(() => {
    photos = signal<ReviewItem[]>([photo('a'), photo('b'), burst('grp', ['f1', 'f2'])]);
    index = signal(0);
    decided = [];

    const feed = {
      photos,
      current: () => photos()[index()],
    };
    const decisions = {
      // Mirror the real decide(): stamp the current unit done and advance, so the viewer re-derives
      // against the new current photo just like in the app.
      decide: (verdict: string) => {
        decided.push(verdict);
        photos.update((list) => list.map((p, i) => (i === index() ? { ...p, status: 'kept' } : p)));
        if (index() < photos().length - 1) index.update((i) => i + 1);
      },
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: ReviewFeedService, useValue: feed },
        { provide: PreviewCacheService, useValue: { url: (id: string) => `url:${id}` } },
        { provide: ReviewDecisionsService, useValue: decisions },
      ],
    });
    service = TestBed.inject(FullscreenViewerService);
  });

  it('openPhoto() shows the current single photo in review mode', () => {
    service.openPhoto();
    expect(service.reviewMode()).toBe(true);
    expect(service.startIndex()).toBe(0);
    expect(service.images()).toEqual([{ label: 'a', url: 'url:a' }]);
  });

  it('openPhoto() is a no-op when the current unit is not a single photo', () => {
    index.set(2); // the burst
    service.openPhoto();
    expect(service.images()).toBeNull();
  });

  it('openBurstCompare() labels frames A/B from the supplied URL map, starting on the tapped frame', () => {
    const urls = new Map<string, SafeUrl>([
      ['f1', 'url:f1'],
      ['f2', 'url:f2'],
    ]);
    service.openBurstCompare({ ids: ['f1', 'f2'], start: 1 }, urls);
    expect(service.reviewMode()).toBe(false);
    expect(service.startIndex()).toBe(1);
    expect(service.images()).toEqual([
      { label: 'A', url: 'url:f1' },
      { label: 'B', url: 'url:f2' },
    ]);
  });

  it('verdict() decides the current photo and advances the viewer to the next single photo', () => {
    service.openPhoto();
    service.verdict('kept');
    expect(decided).toEqual(['kept']);
    expect(service.images()).toEqual([{ label: 'b', url: 'url:b' }]); // moved to the next photo
  });

  it('verdict() closes the viewer when the next unit is not a single photo', () => {
    index.set(1); // photo 'b'; the next unit is the burst
    service.openPhoto();
    service.verdict('rejected');
    expect(service.images()).toBeNull(); // next is a burst → close instead of advancing
  });

  it('close() clears the viewer', () => {
    service.openPhoto();
    service.close();
    expect(service.images()).toBeNull();
  });
});
