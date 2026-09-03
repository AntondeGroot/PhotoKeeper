import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ReviewFeedService, dayLabel, todayKey } from './review-feed.service';
import { LightroomService } from '../lightroom.service';
import { ReviewStore } from '../storage/review/review-store';
import { DailyUnitsService } from './selection/daily-units.service';
import { PreviewCacheService } from './preview-cache.service';
import { PreferencesService } from '../preferences.service';
import { Photo, ReviewItem } from '../photo';

const photo = (id: string, status: Photo['status'] = 'backlog'): Photo => ({
  id,
  name: id,
  album: null,
  taken: '2026-01-01',
  status,
  kind: 'photo',
  starred: false,
  saveOnly: false,
});

describe('ReviewFeedService', () => {
  let service: ReviewFeedService;
  let dailyFeed: Map<string, ReviewItem[]>;
  let prefs: {
    dailyGoal: () => number;
    vacationAlbumIds: () => string[];
    deviceEnabled: () => boolean;
    deviceFolders: () => { name: string; count: number; enabled: boolean }[];
  };

  beforeEach(() => {
    dailyFeed = new Map();
    prefs = {
      dailyGoal: () => 15,
      vacationAlbumIds: () => [],
      deviceEnabled: () => false,
      deviceFolders: () => [],
    };
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ReviewStore,
          useValue: {
            getDailyFeed: (k: string) => Promise.resolve(dailyFeed.get(k)),
            setDailyFeed: (k: string, v: ReviewItem[]) => {
              dailyFeed.set(k, v);
              return Promise.resolve();
            },
            getVerdicts: () => Promise.resolve(new Map()),
            pruneDailyFeedExcept: () => Promise.resolve(),
          },
        },
        { provide: DailyUnitsService, useValue: { buildUnits: () => Promise.resolve([]) } },
        { provide: LightroomService, useValue: { getFeed: () => of({ resources: [] }) } },
        {
          provide: PreviewCacheService,
          useValue: {
            evictDurableExcept: () => Promise.resolve(),
            warmDurable: () => Promise.resolve(),
          },
        },
        { provide: PreferencesService, useValue: prefs },
      ],
    });
    service = TestBed.inject(ReviewFeedService);
  });

  it("loadToday() loads today's cached feed and resumes at the first un-reviewed unit", async () => {
    dailyFeed.set(todayKey(), [photo('a', 'kept'), photo('b', 'backlog')]);
    await service.loadToday();
    expect(service.photos().map((p) => p.id)).toEqual(['a', 'b']);
    expect(service.index()).toBe(1); // first backlog
    expect(service.loaded()).toBe(true);
  });

  it('loadToday() appends enabled device photos to the deck', async () => {
    dailyFeed.set(todayKey(), [photo('a')]);
    prefs.deviceEnabled = () => true;
    prefs.deviceFolders = () => [{ name: 'Camera', count: 1, enabled: true }];

    await service.loadToday();

    const ids = service.photos().map((p) => p.id);
    expect(ids).toContain('a');
    expect(ids.some((id) => id.startsWith('DEV_'))).toBe(true); // device photos appended
  });

  it('loadMore() sets canLoadMore false when nothing fresh remains', async () => {
    service.photos.set([photo('a')]); // 'a' already queued; sampler returns nothing new
    await service.loadMore();
    expect(service.canLoadMore()).toBe(false);
  });

  it('refreshDeviceDeck() reconciles device photos against the current settings', async () => {
    service.photos.set([photo('lr-1')]); // a Lightroom photo
    prefs.deviceEnabled = () => true;
    prefs.deviceFolders = () => [{ name: 'Camera', count: 1, enabled: true }];

    await service.refreshDeviceDeck();

    const ids = service.photos().map((p) => p.id);
    expect(ids).toContain('lr-1'); // Lightroom photo kept
    expect(ids.some((id) => id.startsWith('DEV_'))).toBe(true);
  });
});

describe('dayLabel', () => {
  it('spells the day out the way the header reads it', () => {
    expect(dayLabel(new Date(2026, 5, 9))).toBe('Tuesday 9 June');
  });

  it('stays English regardless of the device locale', () => {
    // The phone this runs on is set to nl-NL; a Dutch weekday under an English wordmark would
    // read as a bug, not as localisation.
    expect(dayLabel(new Date(2026, 7, 6))).toBe('Thursday 6 August');
  });
});
