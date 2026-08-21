import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { authRefreshInterceptor } from './auth-refresh.interceptor';
import { LightroomService } from './lightroom.service';

const REFRESH_URL = 'api/auth/refresh';
const FRESH_TOKENS = { accessToken: 'new-acc', refreshToken: 'new-ref', expiresIn: 3599 };

describe('authRefreshInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let svc: LightroomService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr(), withInterceptors([authRefreshInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    svc = TestBed.inject(LightroomService);
    svc.setTokens('old-acc', 'old-ref');
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  /** Fails a pending request the way an expired access token arrives: a 401 from the backend. */
  function expire(url: string): void {
    httpMock.expectOne(url).flush(null, { status: 401, statusText: 'Unauthorized' });
  }

  it('refreshes the token and retries the request once', () => {
    let body: unknown;
    http.get('api/albums').subscribe((res) => (body = res));

    expire('api/albums');
    httpMock.expectOne(REFRESH_URL).flush(FRESH_TOKENS);
    const retry = httpMock.expectOne('api/albums');

    expect(retry.request.headers.get('X-Auth-Token')).toBe('new-acc');
    retry.flush([{ id: 'a1', name: 'Trip' }]);
    expect(body).toEqual([{ id: 'a1', name: 'Trip' }]);
  });

  it('refreshes once for requests that expire together, not once each', () => {
    // The app always has several calls in the air — the feed, the albums, every preview — and they
    // expire at the same moment. Adobe rotates the refresh token, so a second refresh sent with the
    // token the first one just spent comes back rejected and takes the good session down with it.
    http.get('api/albums').subscribe();
    http.get('api/feed').subscribe();
    http.get('api/photos/p1/rendition').subscribe();

    expire('api/albums');
    expire('api/feed');
    expire('api/photos/p1/rendition');

    httpMock.expectOne(REFRESH_URL).flush(FRESH_TOKENS);

    // All three retry on the single refreshed token.
    for (const url of ['api/albums', 'api/feed', 'api/photos/p1/rendition']) {
      const retry = httpMock.expectOne(url);
      expect(retry.request.headers.get('X-Auth-Token')).toBe('new-acc');
      retry.flush({});
    }
  });

  it('starts a new refresh for a later expiry once the first has settled', () => {
    http.get('api/albums').subscribe();
    expire('api/albums');
    httpMock.expectOne(REFRESH_URL).flush(FRESH_TOKENS);
    httpMock.expectOne('api/albums').flush([]);

    // An hour later the new token expires too; the shared refresh must not still be latched open.
    http.get('api/feed').subscribe();
    expire('api/feed');
    httpMock.expectOne(REFRESH_URL).flush(FRESH_TOKENS);
    httpMock.expectOne('api/feed').flush({});
  });

  it('keeps the tokens when the refresh fails for a reason that is not the token', () => {
    // The Pi restarting mid-deploy, IMS having a moment, a dropped connection. Signing in to Adobe
    // again fixes none of those, and throwing the credentials away turns a blip into a lost session.
    http.get('api/albums').subscribe({ error: () => undefined });

    expire('api/albums');
    httpMock.expectOne(REFRESH_URL).flush(null, { status: 502, statusText: 'Bad Gateway' });

    expect(svc.getRefreshToken()).toBe('old-ref');
    expect(svc.getAccessToken()).toBe('old-acc');
    expect(svc.sessionLost()).toBe(false);
  });

  it('gives up the session only when Adobe rejects the refresh token itself', () => {
    http.get('api/albums').subscribe({ error: () => undefined });

    expire('api/albums');
    httpMock.expectOne(REFRESH_URL).flush(null, { status: 401, statusText: 'Unauthorized' });

    expect(svc.getRefreshToken()).toBeNull();
    expect(svc.sessionLost()).toBe(true);
  });

  it('does not try to refresh the refresh call itself', () => {
    svc.refresh().subscribe({ error: () => undefined });

    httpMock.expectOne(REFRESH_URL).flush(null, { status: 401, statusText: 'Unauthorized' });

    httpMock.verify(); // a second refresh here would be an infinite regress
  });

  it('leaves a 401 alone when there is no refresh token to spend', () => {
    svc.forgetSession();
    let status: number | undefined;
    http.get('api/albums').subscribe({ error: (e: { status: number }) => (status = e.status) });

    expire('api/albums');

    expect(status).toBe(401);
  });
});
