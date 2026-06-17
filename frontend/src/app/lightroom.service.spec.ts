import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { LightroomService } from './lightroom.service';

const ACCESS_KEY = 'lr-access-token';
const REFRESH_KEY = 'lr-refresh-token';
const CATALOG_KEY = 'lr-catalog-id';

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

  describe('loginHref', () => {
    it('returns the relative login path', () => {
      expect(service.loginHref()).toBe('api/auth/login');
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
      req.flush(new Blob());
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
