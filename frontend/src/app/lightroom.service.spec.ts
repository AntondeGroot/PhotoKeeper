import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import {
  isAuthFailure,
  isBundledApp,
  isOffline,
  isUpstreamFailure,
  LightroomService,
  loginHrefUnder,
} from './lightroom.service';

const ACCESS_KEY = 'lr-access-token';
const REFRESH_KEY = 'lr-refresh-token';
const CATALOG_KEY = 'lr-catalog-id';
const HAD_SESSION_KEY = 'lr-had-session';

describe('LightroomService', () => {
  let service: LightroomService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withXhr()), provideHttpClientTesting()],
    });
    service = TestBed.inject(LightroomService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  describe('token + catalog storage', () => {
    it('setTokens stores the access and refresh tokens', () => {
      service.setTokens('acc', 'ref');

      expect(service.getAccessToken()).toBe('acc');
      expect(service.getRefreshToken()).toBe('ref');
    });

    it('returns null when nothing is stored', () => {
      expect(service.getAccessToken()).toBeNull();
      expect(service.getRefreshToken()).toBeNull();
      expect(service.getCatalogId()).toBeNull();
    });

    it('clearTokens removes the access token, refresh token, and catalog id', () => {
      service.setTokens('acc', 'ref');
      localStorage.setItem(CATALOG_KEY, 'cat-1');

      service.clearTokens();

      expect(localStorage.getItem(ACCESS_KEY)).toBeNull();
      expect(localStorage.getItem(REFRESH_KEY)).toBeNull();
      expect(localStorage.getItem(CATALOG_KEY)).toBeNull();
    });
  });

  describe('losing and forgetting a session', () => {
    it('remembers that this device has connected, so a returning user is told apart from a new one', () => {
      expect(service.hadSession()).toBe(false);

      service.setTokens('acc', 'ref');

      expect(service.hadSession()).toBe(true);
    });

    it('raises sessionLost when a session that existed is dropped', () => {
      service.setTokens('acc', 'ref');

      service.loseSession();

      expect(service.sessionLost()).toBe(true);
      expect(service.getAccessToken()).toBeNull();
      // Kept: it is what tells the app to offer "connect again" rather than first-run onboarding.
      expect(localStorage.getItem(HAD_SESSION_KEY)).not.toBeNull();
    });

    it('stays quiet for a device that never connected Lightroom', () => {
      service.loseSession();

      // Nothing expired, so nothing to announce — a device-only user is not shown a sign-in prompt.
      expect(service.sessionLost()).toBe(false);
    });

    it('forgetting the session leaves nothing to prompt about', () => {
      service.setTokens('acc', 'ref');
      service.loseSession();

      service.forgetSession(); // Settings → Disconnect

      expect(service.sessionLost()).toBe(false);
      expect(service.hadSession()).toBe(false);
    });

    it('signing back in stands the prompt down', () => {
      service.setTokens('acc', 'ref');
      service.loseSession();

      service.setTokens('acc-2', 'ref-2');

      expect(service.sessionLost()).toBe(false);
    });
  });

  describe('loginHref', () => {
    const BROWSER_UA = 'Mozilla/5.0 (Linux; Android 15) Chrome/150.0.0.0 Mobile Safari/537.36';
    const SHELL_UA = `${BROWSER_UA} PhotoKeeperApp`;

    it('points at the backend port under ng serve, where the page is on a different origin', () => {
      expect(loginHrefUnder('https://localhost:8080/', BROWSER_UA)).toBe(
        'https://localhost:8080/api/auth/login',
      );
    });

    it('keeps the deployment path prefix instead of jumping to the host root', () => {
      expect(loginHrefUnder('https://antondegroot.uk/photokeeper/', BROWSER_UA)).toBe(
        'https://antondegroot.uk/photokeeper/api/auth/login',
      );
    });

    it('asks the backend to return to the app when the Android shell is the caller', () => {
      expect(loginHrefUnder('https://antondegroot.uk/photokeeper/', SHELL_UA)).toBe(
        'https://antondegroot.uk/photokeeper/api/auth/login?client=app',
      );
    });
  });

  /**
   * Whether this page is the app or the website. The app carries the frontend inside the APK, so it
   * shares no origin with the backend and its calls have to be aimed at the Pi explicitly; the
   * website is served by the backend and resolves them against itself.
   */
  describe('isBundledApp', () => {
    const BROWSER_UA = 'Mozilla/5.0 (Linux; Android 15) Chrome/150.0.0.0 Mobile Safari/537.36';
    const SHELL_UA = `${BROWSER_UA} PhotoKeeperApp`;

    it('recognises the app serving its own bundle', () => {
      expect(isBundledApp('https://photokeeper/', SHELL_UA)).toBe(true);
    });

    it('does not for the website, which the backend serves itself', () => {
      expect(isBundledApp('https://antondegroot.uk/photokeeper/', SHELL_UA)).toBe(false);
      expect(isBundledApp('http://localhost:6200/', BROWSER_UA)).toBe(false); // ng serve
    });

    /**
     * Both halves are required. The origin is the real signal — nothing else is served from
     * `https://photokeeper` — and the user agent is the check that it is genuinely the shell, so a
     * page that merely arrived at that origin some other way cannot redirect the app's API calls.
     */
    it('does not on the right origin without the shell that goes with it', () => {
      expect(isBundledApp('https://photokeeper/', BROWSER_UA)).toBe(false);
    });

    /** Matched as a whole origin, so a host that merely begins the same way is not mistaken for it. */
    it('does not for a host that only begins with the app’s name', () => {
      expect(isBundledApp('https://photokeeper.example.test/', SHELL_UA)).toBe(false);
    });
  });

  /**
   * Being unable to reach the backend is not the same as being turned away by it, and the app leans
   * on the difference: one is a notice over a session that still works, the other is a sign-in.
   */
  describe('offline', () => {
    it('reads a request that got no answer at all as offline', () => {
      expect(isOffline(new HttpErrorResponse({ status: 0 }))).toBe(true);
    });

    it('does not read a refusal as offline — the backend answered', () => {
      expect(isOffline(new HttpErrorResponse({ status: 401 }))).toBe(false);
      expect(isOffline(new HttpErrorResponse({ status: 424 }))).toBe(false);
    });

    /**
     * The backend reports a failing Lightroom as 424 rather than 502, because a CDN substitutes its
     * own page for an origin 502 and that page has no CORS headers — so the app received nothing but
     * an opaque failure, which is the same signature as having no network and was reported as such.
     */
    it('recognises a Lightroom outage as its own thing, not as being offline', () => {
      const outage = new HttpErrorResponse({ status: 424 });

      expect(isUpstreamFailure(outage)).toBe(true);
      expect(isOffline(outage)).toBe(false);
    });

    it('works from stored data for a Lightroom outage too, and says which it was', () => {
      localStorage.setItem('lr-catalog-id', 'cat-1');

      expect(service.resumeOffline(new HttpErrorResponse({ status: 424 }))).toBe(true);
      expect(service.offline()).toBe(true);
      expect(service.offlineReason()).toBe('lightroom');
    });

    it('calls a dead network a dead network', () => {
      localStorage.setItem('lr-catalog-id', 'cat-1');

      service.resumeOffline(new HttpErrorResponse({ status: 0 }));

      expect(service.offlineReason()).toBe('device');
    });

    it('carries on with the stored catalog when the backend cannot be reached', () => {
      localStorage.setItem('lr-catalog-id', 'cat-1');

      expect(service.resumeOffline(new HttpErrorResponse({ status: 0 }))).toBe(true);
      expect(service.offline()).toBe(true);
      expect(service.connected()).toBe(true);
    });

    /**
     * The catalog id is what every later call is addressed with, and it is only cached once a
     * connection has succeeded. Without one there is nothing stored to work from, so the failure has
     * to be reported rather than papered over.
     */
    it('refuses to go offline on a device that never finished connecting', () => {
      localStorage.removeItem('lr-catalog-id');

      expect(service.resumeOffline(new HttpErrorResponse({ status: 0 }))).toBe(false);
      expect(service.offline()).toBe(false);
    });

    it('never goes offline on a rejected session — that needs a sign-in, not a notice', () => {
      localStorage.setItem('lr-catalog-id', 'cat-1');

      expect(service.resumeOffline(new HttpErrorResponse({ status: 401 }))).toBe(false);
      expect(service.offline()).toBe(false);
    });
  });

  describe('loadCatalogId', () => {
    it('GETs api/catalog with the auth token and caches the id', () => {
      service.setTokens('acc', 'ref');
      let result: string | undefined;

      service.loadCatalogId().subscribe((id) => (result = id));

      const req = httpMock.expectOne('api/catalog');
      expect(req.request.headers.get('X-Auth-Token')).toBe('acc');
      req.flush({ id: 'cat-123' });

      expect(result).toBe('cat-123');
      expect(service.getCatalogId()).toBe('cat-123');
    });
  });

  describe('refresh', () => {
    it('POSTs the refresh token and stores the new token set', () => {
      service.setTokens('old-acc', 'old-ref');

      service.refresh().subscribe();

      const req = httpMock.expectOne('api/auth/refresh');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ refreshToken: 'old-ref' });
      req.flush({ accessToken: 'new-acc', refreshToken: 'new-ref', expiresIn: 3599 });

      expect(service.getAccessToken()).toBe('new-acc');
      expect(service.getRefreshToken()).toBe('new-ref');
    });
  });

  describe('getAlbums', () => {
    it('GETs api/albums with the auth token and catalog id headers', () => {
      service.setTokens('acc', 'ref');
      localStorage.setItem(CATALOG_KEY, 'cat-123');

      service.getAlbums().subscribe();

      const req = httpMock.expectOne('api/albums');
      expect(req.request.headers.get('X-Auth-Token')).toBe('acc');
      expect(req.request.headers.get('X-Catalog-Id')).toBe('cat-123');
      req.flush([{ id: 'a1', name: 'Lisbon' }]);
    });
  });

  describe('getFeed', () => {
    it('GETs api/feed with the vacation ids, limit, and auth headers', () => {
      service.setTokens('acc', 'ref');
      localStorage.setItem(CATALOG_KEY, 'cat-123');

      service.getFeed(['a1', 'a2'], 10).subscribe();

      const req = httpMock.expectOne((r) => r.url === 'api/feed');
      expect(req.request.params.get('vacationAlbums')).toBe('a1,a2');
      expect(req.request.params.get('limit')).toBe('10');
      expect(req.request.headers.get('X-Catalog-Id')).toBe('cat-123');
      req.flush({ resources: [] });
    });
  });

  describe('getAllAlbumAssets', () => {
    it('GETs the album assets endpoint and unwraps resources to a flat array', () => {
      service.setTokens('acc', 'ref');
      localStorage.setItem(CATALOG_KEY, 'cat-123');
      let result: { id: string }[] | undefined;

      service.getAllAlbumAssets('alb-1').subscribe((assets) => (result = assets));

      const req = httpMock.expectOne('api/albums/alb-1/assets');
      expect(req.request.method).toBe('GET');
      expect(req.request.headers.get('X-Auth-Token')).toBe('acc');
      expect(req.request.headers.get('X-Catalog-Id')).toBe('cat-123');
      req.flush({
        resources: [
          { id: 'a1', subtype: 'image' },
          { id: 'a2', subtype: 'image' },
        ],
      });

      expect(result?.map((a) => a.id)).toEqual(['a1', 'a2']);
    });

    it('de-duplicates repeated asset ids from overlapping pagination', () => {
      service.setTokens('acc', 'ref');
      localStorage.setItem(CATALOG_KEY, 'cat-123');
      let result: { id: string }[] | undefined;

      service.getAllAlbumAssets('alb-1').subscribe((assets) => (result = assets));

      httpMock.expectOne('api/albums/alb-1/assets').flush({
        resources: [
          { id: 'a1', subtype: 'image' },
          { id: 'a2', subtype: 'image' },
          { id: 'a1', subtype: 'image' }, // boundary asset repeated across pages
        ],
      });

      expect(result?.map((a) => a.id)).toEqual(['a1', 'a2']);
    });
  });

  describe('getPhotoBlob', () => {
    it('GETs the rendition URL with size, blob responseType, and auth headers', () => {
      service.setTokens('acc', 'ref');
      localStorage.setItem(CATALOG_KEY, 'cat-123');

      service.getPhotoBlob('asset-1', '2048').subscribe();

      const req = httpMock.expectOne((r) => r.url === 'api/photos/asset-1/rendition');
      expect(req.request.params.get('size')).toBe('2048');
      expect(req.request.responseType).toBe('blob');
      expect(req.request.headers.get('X-Auth-Token')).toBe('acc');
      req.flush(new Blob(['img']));
    });
  });

  describe('logout', () => {
    it('DELETEs api/auth/logout', () => {
      service.logout().subscribe();

      const req = httpMock.expectOne('api/auth/logout');
      expect(req.request.method).toBe('DELETE');
      req.flush(null);
    });
  });
});

describe('isAuthFailure', () => {
  const status = (code: number): HttpErrorResponse => new HttpErrorResponse({ status: code });

  it('separates a rejected session from a backend that is merely unreachable', () => {
    // The one status the backend uses to say a token is genuinely spent.
    expect(isAuthFailure(status(401))).toBe(true);

    // A deploy restarts the backend, so these are routine on the first call after one. Treating
    // them as an expired session is what used to throw away perfectly valid Lightroom tokens.
    expect(isAuthFailure(status(0))).toBe(false); // connection refused / offline
    expect(isAuthFailure(status(502))).toBe(false); // Pi still coming up
    expect(isAuthFailure(status(503))).toBe(false);
    expect(isAuthFailure(status(500))).toBe(false);

    // Anything that is not an HTTP failure at all cannot be an auth failure.
    expect(isAuthFailure(new Error('boom'))).toBe(false);
    expect(isAuthFailure(undefined)).toBe(false);
  });

  it('does not read a 403 as a spent token — nothing behind the API issues one', () => {
    // A CORS rule that omitted the deployed origin rejected every POST /api/auth/refresh with 403
    // before it reached the controller. Counting that as Adobe refusing the token signed the user
    // out roughly daily, for a whole month, while their credentials were fine the entire time.
    expect(isAuthFailure(status(403))).toBe(false);
  });
});
