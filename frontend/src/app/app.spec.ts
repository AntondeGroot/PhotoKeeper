import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AppComponent as App } from './app';
import { Photo } from './photo';
import { ReviewStore } from './storage/review-store';
import { StoredVerdict } from './storage/photokeeper-db';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

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

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  describe('rendition prefetch', () => {
    it('preloads the current photo plus the next 5 at 2048px when photos load', () => {
      const fixture = TestBed.createComponent(App);
      const httpMock = TestBed.inject(HttpTestingController);
      const app = fixture.componentInstance;

      app.reviewPhotos.set(Array.from({ length: 10 }, (_, i) => photo('p' + i)));
      app.photosLoaded.set(true);
      fixture.detectChanges();

      // ngOnInit's auth check fires on first change detection; settle it so it isn't left dangling.
      httpMock.expectOne('api/auth/status').flush({ authenticated: false });

      const requests = httpMock.match((r) => isRendition(r.url));
      expect(requests.length).toBe(6); // current + PREFETCH_AHEAD (5)
      requests.forEach((r) => {
        expect(r.request.params.get('size')).toBe('2048');
        r.flush(new Blob());
      });

      // Once the current photo's rendition lands, the computed URL exposes it.
      expect(app.currentReviewPhotoUrl()).not.toBeNull();
      httpMock.verify();
    });

    it('evicts renditions that fall behind the window so revisiting refetches', () => {
      const fixture = TestBed.createComponent(App);
      const httpMock = TestBed.inject(HttpTestingController);
      const app = fixture.componentInstance;

      app.reviewPhotos.set(Array.from({ length: 8 }, (_, i) => photo('p' + i)));
      app.photosLoaded.set(true);
      fixture.detectChanges();
      httpMock.expectOne('api/auth/status').flush({ authenticated: false });
      httpMock.match((r) => isRendition(r.url)).forEach((r) => r.flush(new Blob())); // p0..p5

      // Advance one: p6 enters the window, p0 falls behind and is evicted.
      app.reviewIndex.set(1);
      fixture.detectChanges();
      httpMock.match((r) => isRendition(r.url)).forEach((r) => r.flush(new Blob())); // just p6

      // Returning to p0 refetches it (only it — p1..p5 are still cached).
      app.reviewIndex.set(0);
      fixture.detectChanges();
      const refetch = httpMock.match((r) => isRendition(r.url));
      expect(refetch.length).toBe(1);
      expect(refetch[0].request.url).toContain('p0');
      refetch.forEach((r) => r.flush(new Blob()));
      httpMock.verify();
    });

    it('does not refetch a rendition that is already cached', () => {
      const fixture = TestBed.createComponent(App);
      const httpMock = TestBed.inject(HttpTestingController);
      const app = fixture.componentInstance;

      app.reviewPhotos.set([photo('p0'), photo('p1')]);
      app.photosLoaded.set(true);
      fixture.detectChanges();
      httpMock.expectOne('api/auth/status').flush({ authenticated: false });

      // current + 1 ahead = both photos.
      const initial = httpMock.match((r) => isRendition(r.url));
      expect(initial.length).toBe(2);
      initial.forEach((r) => r.flush(new Blob()));

      // Advancing onto the already-cached p1 issues no new request.
      app.reviewIndex.set(1);
      fixture.detectChanges();

      httpMock.expectNone((r) => isRendition(r.url));
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
        },
      });
      const fixture = TestBed.createComponent(App);
      const httpMock = TestBed.inject(HttpTestingController);
      const app = fixture.componentInstance;

      fixture.detectChanges(); // ngOnInit → init()
      httpMock.expectOne('api/auth/status').flush({ authenticated: true });
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

      expect(app.reviewPhotos().find((p) => p.id === 'p1')?.status).toBe('kept');
      expect(app.reviewPhotos().find((p) => p.id === 'p2')?.status).toBe('backlog');

      // Drain any rendition prefetch the load kicked off.
      httpMock.match((r) => isRendition(r.url)).forEach((r) => r.flush(new Blob()));
      httpMock.verify();
    });
  });
});
