import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AppComponent as App } from './app';
import { Photo, ReviewItem } from './photo';
import { ReviewStore } from './storage/review-store';
import { PreviewStore } from './storage/preview-store';
import { StoredVerdict } from './storage/photokeeper-db';
import { DailyUnitsService } from './selection/daily-units.service';
import { CatalogScanService } from './detection/catalog-scan.service';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// Default no-op preview store: nothing cached on disk, so previews are fetched over HTTP.
const previewStoreStub = {
  get: () => Promise.resolve(undefined),
  put: () => Promise.resolve(),
  evictExcept: () => Promise.resolve(),
};

function photo(id: string): Photo {
  return {
    id,
    name: id,
    album: null,
    taken: '2026-01-01',
    status: 'backlog',
    kind: 'photo',
    starred: false,
    keepsake: false,
  };
}

const isRendition = (url: string) => url.endsWith('/rendition');

// Local-date key matching app.ts's todayKey/tomorrowKey, so tests can drive getDailyFeed by date.
function dayKey(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
const TODAY = dayKey(0);
const TOMORROW = dayKey(1);

// Stubs PhotoStore.getDailyFeed: a one-photo feed for today/tomorrow, nothing for other dates.
function dailyFeedStub(date: string): Photo[] | undefined {
  if (date === TODAY) return [photo('p1')];
  if (date === TOMORROW) return [photo('t1')];
  return undefined;
}

describe('App', () => {
  beforeEach(async () => {
    localStorage.clear(); // isolate stored tokens/settings between tests
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PreviewStore, useValue: previewStoreStub },
        // On-device selection returns nothing by default → loadPhotos falls back to the server getFeed
        // path these tests already drive. The background scan is made inert.
        { provide: DailyUnitsService, useValue: { buildUnits: () => Promise.resolve([]) } },
        { provide: CatalogScanService, useValue: { scanAllAlbums: () => Promise.resolve() } },
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  describe('preview prefetch', () => {
    it('preloads the current photo plus the next 5 at 2048px when photos load', async () => {
      const fixture = TestBed.createComponent(App);
      const httpMock = TestBed.inject(HttpTestingController);
      const app = fixture.componentInstance;

      app.reviewPhotos.set(Array.from({ length: 10 }, (_, i) => photo('p' + i)));
      app.photosLoaded.set(true);
      fixture.detectChanges();
      await tick(); // ensurePreview checks the durable store (async) before fetching

      const requests = httpMock.match((r) => isRendition(r.url));
      expect(requests.length).toBe(6); // current + PREFETCH_AHEAD (5)
      requests.forEach((r) => {
        expect(r.request.params.get('size')).toBe('2048');
        r.flush(new Blob());
      });
      await tick();

      // Once the current photo's preview lands, the computed URL exposes it.
      expect(app.currentReviewPhotoUrl()).not.toBeNull();
      httpMock.verify();
    });

    it('evicts previews that fall behind the window so revisiting refetches', async () => {
      const fixture = TestBed.createComponent(App);
      const httpMock = TestBed.inject(HttpTestingController);
      const app = fixture.componentInstance;

      app.reviewPhotos.set(Array.from({ length: 8 }, (_, i) => photo('p' + i)));
      app.photosLoaded.set(true);
      fixture.detectChanges();
      await tick();
      httpMock.match((r) => isRendition(r.url)).forEach((r) => r.flush(new Blob())); // p0..p5
      await tick();

      // Advance one: p6 enters the window, p0 falls behind and is evicted.
      app.reviewIndex.set(1);
      fixture.detectChanges();
      await tick();
      httpMock.match((r) => isRendition(r.url)).forEach((r) => r.flush(new Blob())); // just p6
      await tick();

      // Returning to p0 refetches it (only it — p1..p5 are still cached).
      app.reviewIndex.set(0);
      fixture.detectChanges();
      await tick();
      const refetch = httpMock.match((r) => isRendition(r.url));
      expect(refetch.length).toBe(1);
      expect(refetch[0].request.url).toContain('p0');
      refetch.forEach((r) => r.flush(new Blob()));
      httpMock.verify();
    });

    it('does not refetch a preview that is already cached', async () => {
      const fixture = TestBed.createComponent(App);
      const httpMock = TestBed.inject(HttpTestingController);
      const app = fixture.componentInstance;

      app.reviewPhotos.set([photo('p0'), photo('p1')]);
      app.photosLoaded.set(true);
      fixture.detectChanges();
      await tick();

      // current + 1 ahead = both photos.
      const initial = httpMock.match((r) => isRendition(r.url));
      expect(initial.length).toBe(2);
      initial.forEach((r) => r.flush(new Blob()));
      await tick();

      // Advancing onto the already-cached p1 issues no new request.
      app.reviewIndex.set(1);
      fixture.detectChanges();
      await tick();

      httpMock.expectNone((r) => isRendition(r.url));
      httpMock.verify();
    });
  });

  describe('durable preview cache', () => {
    it('uses a preview already on disk instead of re-fetching it', async () => {
      TestBed.overrideProvider(PreviewStore, {
        useValue: {
          get: (assetId: string) =>
            Promise.resolve(assetId === 'p0' ? new Blob(['cached']) : undefined),
          put: () => Promise.resolve(),
          evictExcept: () => Promise.resolve(),
        },
      });
      const fixture = TestBed.createComponent(App);
      const httpMock = TestBed.inject(HttpTestingController);
      const app = fixture.componentInstance;

      app.reviewPhotos.set([photo('p0'), photo('p1')]);
      app.photosLoaded.set(true);
      fixture.detectChanges();
      await tick();

      // p0 is on disk → no fetch; p1 is not → fetched.
      const requests = httpMock.match((r) => isRendition(r.url));
      expect(requests.map((r) => r.request.url)).toEqual(['api/photos/p1/rendition']);
      requests.forEach((r) => r.flush(new Blob()));
      await tick();

      // p0's cached blob is exposed as the current image with no network.
      expect(app.currentReviewPhotoUrl()).not.toBeNull();
      httpMock.verify();
    });
  });

  describe('verdict persistence', () => {
    it('saves the verdict to the review store when a photo is decided', () => {
      const saved: { id: string; verdict: StoredVerdict }[] = [];
      TestBed.overrideProvider(ReviewStore, {
        useValue: {
          setVerdict: (id: string, verdict: StoredVerdict) => {
            saved.push({ id, verdict });
            return Promise.resolve();
          },
          getVerdicts: () => Promise.resolve(new Map<string, StoredVerdict>()),
        },
      });
      const fixture = TestBed.createComponent(App);
      const app = fixture.componentInstance;
      app.reviewPhotos.set([photo('p0')]);

      app.decide('kept');

      expect(saved).toEqual([
        { id: 'p0', verdict: { status: 'kept', starred: false, keepsake: false } },
      ]);
    });

    it('re-applies stored verdicts onto freshly loaded photos', async () => {
      const stored = new Map<string, StoredVerdict>([
        ['p1', { status: 'kept', starred: true, keepsake: false }],
      ]);
      TestBed.overrideProvider(ReviewStore, {
        useValue: {
          setVerdict: () => Promise.resolve(),
          getVerdicts: () => Promise.resolve(stored),
          getDailyFeed: () => Promise.resolve(undefined), // no stored selection → sample fresh
          setDailyFeed: () => Promise.resolve(),
          pruneDailyFeedExcept: () => Promise.resolve(),
        },
      });
      localStorage.setItem('lr-access-token', 'acc'); // init enters the load path
      const fixture = TestBed.createComponent(App);
      const httpMock = TestBed.inject(HttpTestingController);
      const app = fixture.componentInstance;

      fixture.detectChanges(); // ngOnInit → init()
      httpMock.expectOne('api/catalog').flush({ id: 'cat-1' });
      await tick();

      httpMock
        .expectOne((r) => r.url === 'api/feed')
        .flush({
          resources: [
            { id: 'p1', subtype: 'image' },
            { id: 'p2', subtype: 'image' },
          ],
        });
      await tick();

      httpMock.expectOne('api/albums').flush([]);
      await tick();

      // No stored tomorrow either → precomputeTomorrow samples it (empty, so nothing warmed).
      httpMock.expectOne((r) => r.url === 'api/feed').flush({ resources: [] });
      await tick();

      expect(app.reviewPhotos().find((p) => p.id === 'p1')?.status).toBe('kept');
      expect(app.reviewPhotos().find((p) => p.id === 'p2')?.status).toBe('backlog');

      // Drain any preview prefetch the load kicked off.
      httpMock.match((r) => isRendition(r.url)).forEach((r) => r.flush(new Blob()));
      httpMock.verify();
    });
  });

  describe('group-aware on-device selection', () => {
    it('loads detected units (including a burst) without sampling the server feed', async () => {
      const burst: ReviewItem = {
        id: 'burst:alb-1:b1',
        name: 'Burst · 2 frames',
        album: 'A',
        taken: '2026-01-01',
        status: 'backlog',
        kind: 'burst',
        photos: [
          { id: 'b1', name: 'b1' },
          { id: 'b2', name: 'b2' },
        ],
      };
      TestBed.overrideProvider(DailyUnitsService, {
        useValue: { buildUnits: () => Promise.resolve([burst, photo('s1')]) },
      });
      TestBed.overrideProvider(ReviewStore, {
        useValue: {
          setVerdict: () => Promise.resolve(),
          getVerdicts: () => Promise.resolve(new Map<string, StoredVerdict>()),
          getDailyFeed: () => Promise.resolve(undefined), // nothing stored → build on-device
          setDailyFeed: () => Promise.resolve(),
          pruneDailyFeedExcept: () => Promise.resolve(),
        },
      });
      localStorage.setItem('lr-access-token', 'acc');
      const fixture = TestBed.createComponent(App);
      const httpMock = TestBed.inject(HttpTestingController);
      const app = fixture.componentInstance;

      fixture.detectChanges();
      httpMock.expectOne('api/catalog').flush({ id: 'cat-1' });
      await tick();

      // The queue holds the detected units, and no api/feed sample was needed.
      expect(app.reviewPhotos().map((u) => u.id)).toEqual(['burst:alb-1:b1', 's1']);
      expect(app.reviewPhotos().some((u) => u.kind === 'burst')).toBe(true);

      httpMock.expectOne('api/albums').flush([]);
      await tick();
      await tick(); // let precomputeTomorrow run

      expect(httpMock.match((r) => r.url === 'api/feed')).toHaveLength(0);
      httpMock.match((r) => isRendition(r.url)).forEach((r) => r.flush(new Blob()));
      httpMock.verify();
    });

    it('sizes the queue to the configured daily goal', async () => {
      localStorage.setItem('dailyGoal', '8'); // ngOnInit reads this into the dailyGoal signal
      TestBed.overrideProvider(ReviewStore, {
        useValue: {
          setVerdict: () => Promise.resolve(),
          getVerdicts: () => Promise.resolve(new Map<string, StoredVerdict>()),
          getDailyFeed: () => Promise.resolve(undefined), // sample fresh (buildUnits stub → [])
          setDailyFeed: () => Promise.resolve(),
          pruneDailyFeedExcept: () => Promise.resolve(),
        },
      });
      localStorage.setItem('lr-access-token', 'acc');
      const fixture = TestBed.createComponent(App);
      const httpMock = TestBed.inject(HttpTestingController);

      fixture.detectChanges();
      httpMock.expectOne('api/catalog').flush({ id: 'cat-1' });
      await tick();

      const feedReq = httpMock.expectOne((r) => r.url === 'api/feed');
      expect(feedReq.request.params.get('limit')).toBe('8'); // goal drives the sample size, not a fixed 20
      feedReq.flush({ resources: [] });
      await tick();

      httpMock.expectOne('api/albums').flush([]);
      await tick();
      httpMock.match((r) => r.url === 'api/feed').forEach((r) => r.flush({ resources: [] }));
      httpMock.match((r) => isRendition(r.url)).forEach((r) => r.flush(new Blob()));
      httpMock.verify();
    });
  });

  describe('stable daily selection', () => {
    it("reuses today's stored selection instead of re-sampling the feed", async () => {
      const selection = [photo('p1'), photo('p2')];
      TestBed.overrideProvider(ReviewStore, {
        useValue: {
          setVerdict: () => Promise.resolve(),
          getVerdicts: () => Promise.resolve(new Map<string, StoredVerdict>()),
          getDailyFeed: () => Promise.resolve(selection), // already chosen today
          setDailyFeed: () => Promise.resolve(),
          pruneDailyFeedExcept: () => Promise.resolve(),
        },
      });
      localStorage.setItem('lr-access-token', 'acc'); // init enters the load path
      const fixture = TestBed.createComponent(App);
      const httpMock = TestBed.inject(HttpTestingController);
      const app = fixture.componentInstance;

      fixture.detectChanges();
      httpMock.expectOne('api/catalog').flush({ id: 'cat-1' });
      await tick();

      // No feed request — the stored selection is reused.
      httpMock.expectNone((r) => r.url === 'api/feed');
      httpMock.expectOne('api/albums').flush([]);
      await tick();

      expect(app.reviewPhotos().map((p) => p.id)).toEqual(['p1', 'p2']);

      httpMock.match((r) => isRendition(r.url)).forEach((r) => r.flush(new Blob()));
      httpMock.verify();
    });

    it('resumes at the first un-reviewed photo, skipping ones already done', async () => {
      const selection = [photo('p1'), photo('p2'), photo('p3')];
      const verdicts = new Map<string, StoredVerdict>([
        ['p1', { status: 'kept', starred: false, keepsake: false }],
        ['p2', { status: 'rejected', starred: false, keepsake: false }],
      ]);
      TestBed.overrideProvider(ReviewStore, {
        useValue: {
          setVerdict: () => Promise.resolve(),
          getVerdicts: () => Promise.resolve(verdicts),
          getDailyFeed: () => Promise.resolve(selection),
          setDailyFeed: () => Promise.resolve(),
          pruneDailyFeedExcept: () => Promise.resolve(),
        },
      });
      localStorage.setItem('lr-access-token', 'acc'); // init enters the load path
      const fixture = TestBed.createComponent(App);
      const httpMock = TestBed.inject(HttpTestingController);
      const app = fixture.componentInstance;

      fixture.detectChanges();
      httpMock.expectOne('api/catalog').flush({ id: 'cat-1' });
      await tick();
      httpMock.expectOne('api/albums').flush([]);
      await tick();

      // p1 and p2 are already decided → the cursor resumes on p3, and the count still reflects 2 done.
      expect(app.currentReviewPhoto().id).toBe('p3');
      expect(app.doneToday()).toBe(2);

      httpMock.match((r) => isRendition(r.url)).forEach((r) => r.flush(new Blob()));
      httpMock.verify();
    });
  });

  describe('precompute tomorrow', () => {
    it("samples tomorrow's feed and warms its previews into the durable store", async () => {
      const setFeeds: { date: string; ids: string[] }[] = [];
      const puts: string[] = [];
      TestBed.overrideProvider(ReviewStore, {
        useValue: {
          setVerdict: () => Promise.resolve(),
          getVerdicts: () => Promise.resolve(new Map<string, StoredVerdict>()),
          // Today is already chosen; tomorrow is not → precompute samples it.
          getDailyFeed: (date: string) =>
            Promise.resolve(date === TODAY ? [photo('p1')] : undefined),
          setDailyFeed: (date: string, photos: Photo[]) => {
            setFeeds.push({ date, ids: photos.map((p) => p.id) });
            return Promise.resolve();
          },
          pruneDailyFeedExcept: () => Promise.resolve(),
        },
      });
      TestBed.overrideProvider(PreviewStore, {
        useValue: {
          get: () => Promise.resolve(undefined), // nothing on disk → everything fetched
          put: (id: string) => {
            puts.push(id);
            return Promise.resolve();
          },
          evictExcept: () => Promise.resolve(),
        },
      });
      localStorage.setItem('lr-access-token', 'acc');
      const fixture = TestBed.createComponent(App);
      const httpMock = TestBed.inject(HttpTestingController);
      const app = fixture.componentInstance;

      fixture.detectChanges();
      httpMock.expectOne('api/catalog').flush({ id: 'cat-1' });
      await tick();
      httpMock.expectOne('api/albums').flush([]); // today's selection reused → no today feed
      await tick();

      // precomputeTomorrow samples tomorrow's feed...
      httpMock
        .expectOne((r) => r.url === 'api/feed')
        .flush({ resources: [{ id: 't1', subtype: 'image' }] });
      await tick();

      // ...stores it under tomorrow's key and warms its preview (plus today's p1 prefetch).
      httpMock.match((r) => isRendition(r.url)).forEach((r) => r.flush(new Blob()));
      await tick();

      expect(setFeeds).toEqual([{ date: TOMORROW, ids: ['t1'] }]);
      expect(puts).toContain('t1');
      expect(app.reviewPhotos().map((p) => p.id)).toEqual(['p1']); // today's feed untouched
      httpMock.verify();
    });

    it('skips sampling and refetching when tomorrow is already chosen and warmed', async () => {
      const puts: string[] = [];
      TestBed.overrideProvider(ReviewStore, {
        useValue: {
          setVerdict: () => Promise.resolve(),
          getVerdicts: () => Promise.resolve(new Map<string, StoredVerdict>()),
          getDailyFeed: (date: string) => Promise.resolve(dailyFeedStub(date)),
          setDailyFeed: () => Promise.resolve(),
          pruneDailyFeedExcept: () => Promise.resolve(),
        },
      });
      TestBed.overrideProvider(PreviewStore, {
        useValue: {
          get: (id: string) => Promise.resolve(id === 't1' ? new Blob() : undefined), // t1 warmed
          put: (id: string) => {
            puts.push(id);
            return Promise.resolve();
          },
          evictExcept: () => Promise.resolve(),
        },
      });
      localStorage.setItem('lr-access-token', 'acc');
      const fixture = TestBed.createComponent(App);
      const httpMock = TestBed.inject(HttpTestingController);

      fixture.detectChanges();
      httpMock.expectOne('api/catalog').flush({ id: 'cat-1' });
      await tick();
      httpMock.expectOne('api/albums').flush([]);
      await tick();

      // Tomorrow already chosen → no feed sample; already warmed → no t1 refetch.
      httpMock.expectNone((r) => r.url === 'api/feed');
      httpMock.match((r) => isRendition(r.url)).forEach((r) => r.flush(new Blob())); // only today's p1
      await tick();

      expect(puts).not.toContain('t1');
      httpMock.verify();
    });

    it("keeps tomorrow's previews when evicting earlier days", async () => {
      let evictKeep: Set<string> | undefined;
      TestBed.overrideProvider(ReviewStore, {
        useValue: {
          setVerdict: () => Promise.resolve(),
          getVerdicts: () => Promise.resolve(new Map<string, StoredVerdict>()),
          getDailyFeed: (date: string) => Promise.resolve(dailyFeedStub(date)),
          setDailyFeed: () => Promise.resolve(),
          pruneDailyFeedExcept: () => Promise.resolve(),
        },
      });
      TestBed.overrideProvider(PreviewStore, {
        useValue: {
          get: () => Promise.resolve(new Blob()), // everything warmed → no fetches to drain
          put: () => Promise.resolve(),
          evictExcept: (keep: Set<string>) => {
            evictKeep = keep;
            return Promise.resolve();
          },
        },
      });
      localStorage.setItem('lr-access-token', 'acc');
      const fixture = TestBed.createComponent(App);
      const httpMock = TestBed.inject(HttpTestingController);

      fixture.detectChanges();
      httpMock.expectOne('api/catalog').flush({ id: 'cat-1' });
      await tick();
      httpMock.expectOne('api/albums').flush([]);
      await tick();

      expect(evictKeep?.has('p1')).toBe(true); // today's selection
      expect(evictKeep?.has('t1')).toBe(true); // tomorrow's warm-ahead survives eviction
      httpMock.verify();
    });
  });
});
