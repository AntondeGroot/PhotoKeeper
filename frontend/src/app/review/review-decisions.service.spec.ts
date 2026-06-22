import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ReviewDecisionsService } from './review-decisions.service';
import { ReviewFeedService, todayKey } from './review-feed.service';
import { ReviewStore } from '../storage/review/review-store';
import { GroupOverrideStore } from '../storage/detection/group-override-store';
import { BackgroundScanService } from '../detection/scan/background-scan.service';
import { PreferencesService } from '../preferences.service';
import { Burst, Pano, Photo, ReviewItem } from '../photo';
import { StoredVerdict } from '../storage/photokeeper-db';

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
  album: 'Trip',
  taken: '2026-01-01',
  status: 'backlog',
  kind: 'burst',
  photos: frameIds.map((fid) => ({ id: fid, name: fid })),
});

describe('ReviewDecisionsService', () => {
  let service: ReviewDecisionsService;
  // Minimal fake feed: a writable deck + cursor with the three navigation helpers the service uses.
  let photos: ReturnType<typeof signal<ReviewItem[]>>;
  let index: ReturnType<typeof signal<number>>;
  let loaded: ReturnType<typeof signal<boolean>>;
  let verdicts: { id: string; verdict: StoredVerdict }[];
  let dailyFeeds: Map<string, ReviewItem[]>;
  let dissolves: { memberIds: string[] }[];
  let reclassifies: { memberIds: string[]; type: string; orientation?: string }[];
  let refillCalls: number;

  beforeEach(() => {
    photos = signal<ReviewItem[]>([photo('a'), photo('b'), photo('c')]);
    index = signal(0);
    loaded = signal(true);
    verdicts = [];
    dailyFeeds = new Map();
    dissolves = [];
    reclassifies = [];
    refillCalls = 0;
    localStorage.removeItem('celebratedGoal');

    const feed = {
      photos,
      index,
      loaded,
      current: () => photos()[index()],
      advance: () => {
        if (index() < photos().length - 1) index.update((i) => i + 1);
      },
      back: () => {
        if (index() > 0) index.update((i) => i - 1);
      },
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: ReviewFeedService, useValue: feed },
        {
          provide: ReviewStore,
          useValue: {
            setVerdict: (id: string, verdict: StoredVerdict) => {
              verdicts.push({ id, verdict });
              return Promise.resolve();
            },
            setDailyFeed: (k: string, v: ReviewItem[]) => {
              dailyFeeds.set(k, v);
              return Promise.resolve();
            },
          },
        },
        {
          provide: GroupOverrideStore,
          useValue: {
            dissolve: (o: { memberIds: string[] }) => {
              dissolves.push(o);
              return Promise.resolve();
            },
            reclassify: (o: { memberIds: string[]; type: string; orientation?: string }) => {
              reclassifies.push(o);
              return Promise.resolve();
            },
          },
        },
        { provide: BackgroundScanService, useValue: { scheduleRefill: () => refillCalls++ } },
        { provide: PreferencesService, useValue: { dailyGoal: () => 99 } },
      ],
    });
    service = TestBed.inject(ReviewDecisionsService);
    service.bindAuth(() => true);
  });

  it('decide() sets the current unit status, persists it, and advances the cursor', async () => {
    service.decide('kept');
    await Promise.resolve();
    expect(photos()[0].status).toBe('kept');
    expect(index()).toBe(1);
    expect(verdicts).toEqual([
      { id: 'a', verdict: { status: 'kept', starred: false, keepsake: false } },
    ]);
    expect(refillCalls).toBe(1); // every decision tops up the scan buffer
  });

  it('toggleStar() flips the star without advancing', () => {
    service.toggleStar();
    expect((photos()[0] as Photo).starred).toBe(true);
    expect(index()).toBe(0);
  });

  it('resolveBurst() keeps the winner, rejects the rest, and marks the unit done', async () => {
    photos.set([burst('grp', ['f1', 'f2', 'f3'])]);
    index.set(0);
    service.resolveBurst('f2');
    await Promise.resolve();
    expect(photos()[0].status).toBe('kept'); // the burst unit itself is done
    expect(verdicts).toContainEqual({
      id: 'f2',
      verdict: { status: 'kept', starred: false, keepsake: false },
    });
    expect(verdicts).toContainEqual({
      id: 'f1',
      verdict: { status: 'rejected', starred: false, keepsake: false },
    });
    expect(verdicts).toContainEqual({
      id: 'f3',
      verdict: { status: 'rejected', starred: false, keepsake: false },
    });
  });

  it('dissolveBurst() expands the group into single photos and records the override', () => {
    photos.set([burst('grp', ['f1', 'f2'])]);
    index.set(0);
    service.dissolveBurst();
    expect(photos().map((p) => p.id)).toEqual(['f1', 'f2']);
    expect(photos().every((p) => p.kind === 'photo')).toBe(true);
    expect(dailyFeeds.get(todayKey())?.length).toBe(2); // re-persisted
    expect(dissolves.length).toBe(1);
    expect(dissolves[0].memberIds).toEqual(['f1', 'f2']);
  });

  it('markBurstAsPano() re-types the unit in place and records the reclassify', () => {
    photos.set([burst('grp', ['f1', 'f2'])]);
    index.set(0);
    service.markBurstAsPano();
    const unit = photos()[0] as Pano;
    expect(unit.kind).toBe('pano');
    expect(unit.frames.map((f) => f.id)).toEqual(['f1', 'f2']);
    expect(reclassifies.length).toBe(1);
    expect(reclassifies[0]).toMatchObject({
      memberIds: ['f1', 'f2'],
      type: 'pano',
      orientation: 'horizontal',
    });
  });

  it('promoteToPrint() marks the photo toPrint and bumps the edit count', () => {
    service.promoteToPrint('a');
    expect(photos()[0].status).toBe('toPrint');
    expect(service.editedToday()).toBe(1);
  });

  it('fires the goal celebration once the day count reaches the goal', async () => {
    TestBed.resetTestingModule(); // re-provision with a reachable goal of 1
    photos = signal<ReviewItem[]>([photo('a'), photo('b')]);
    index = signal(0);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ReviewFeedService,
          useValue: {
            photos,
            index,
            loaded: signal(true),
            current: () => photos()[index()],
            advance: () => index.update((i) => i + 1),
            back: () => {},
          },
        },
        { provide: ReviewStore, useValue: { setVerdict: () => Promise.resolve() } },
        { provide: GroupOverrideStore, useValue: {} },
        { provide: BackgroundScanService, useValue: { scheduleRefill: () => {} } },
        { provide: PreferencesService, useValue: { dailyGoal: () => 1 } },
      ],
    });
    service = TestBed.inject(ReviewDecisionsService);
    service.bindAuth(() => true);

    service.decide('kept'); // 1 done, goal is 1
    await Promise.resolve();
    expect(service.celebration()?.title).toContain('daily goal done');
    expect(localStorage.getItem('celebratedGoal')).toBe(todayKey());
  });
});
