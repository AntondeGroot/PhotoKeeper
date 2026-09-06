import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { ReviewFeedService } from './review-feed.service';
import { dayLabel, todayKey } from './day';
import { DayService } from './day.service';
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
  let today: ReturnType<typeof signal<string>>;
  let kept: Set<string> | null;
  let prefs: {
    dailyGoal: () => number;
    vacationAlbumIds: () => string[];
    deviceEnabled: () => boolean;
    deviceFolders: () => { name: string; count: number; enabled: boolean }[];
  };

  beforeEach(() => {
    dailyFeed = new Map();
    today = signal(todayKey());
    kept = null;
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
            evictDurableExcept: (keep: Set<string>) => {
              kept = keep;
              return Promise.resolve();
            },
            warmDurable: () => Promise.resolve(),
            // The recent-decisions list pins its thumbnails while it is open (see the pin effect).
            pin: () => undefined,
            ensure: () => Promise.resolve(),
          },
        },
        { provide: PreferencesService, useValue: prefs },
        { provide: DayService, useValue: { today } },
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

  // Previews are keyed by asset, while a burst is one unit under a synthetic id. Keeping unit ids
  // therefore kept nothing at all for a group: its frames were evicted on every load and downloaded
  // again the moment the deck reached them.
  it('keeps the previews of a group unit’s frames, not its unit id', async () => {
    const burstUnit: ReviewItem = {
      id: 'burst:alb-1:f1',
      name: 'Burst · 2 frames',
      album: 'Trip',
      taken: '2026-01-01',
      status: 'backlog',
      kind: 'burst',
      photos: [
        { id: 'f1', name: 'f1' },
        { id: 'f2', name: 'f2' },
      ],
    };
    dailyFeed.set(todayKey(), [burstUnit, photo('a')]);

    await service.loadToday();

    expect([...(kept ?? [])].sort((a, b) => a.localeCompare(b))).toEqual(['a', 'f1', 'f2']);
  });

  // An app left open overnight went on showing the previous day's finished deck: everything the
  // review screen shows is scoped to a day, and all of it was decided once at boot.
  it('reloads the deck when the day turns over under an open app', async () => {
    dailyFeed.set(todayKey(), [photo('a', 'kept')]);
    await service.loadToday();
    expect(service.photos().map((p) => p.id)).toEqual(['a']);

    dailyFeed.set('2026-12-25', [photo('b')]);
    today.set('2026-12-25');
    TestBed.tick(); // the reload is raised by an effect watching the day

    // Waited for rather than flushed by hand: the reload is several awaits deep, and counting
    // microtasks would pin the test to the shape of loadToday rather than to what it achieves.
    await vi.waitFor(() => expect(service.photos().map((p) => p.id)).toEqual(['b']));
  });

  // ...but it must not start a session that was never under way, or a deck would be fetched for a
  // user who has not opened the review screen at all.
  it('leaves an unloaded feed alone when the day turns over', async () => {
    dailyFeed.set('2026-12-25', [photo('b')]);

    today.set('2026-12-25');
    TestBed.tick();
    await Promise.resolve();
    await Promise.resolve();

    expect(service.loaded()).toBe(false);
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
