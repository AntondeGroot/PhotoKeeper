import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { LightroomService } from './lightroom.service';

const TOKEN_KEY = 'lr-auth-token';

describe('LightroomService', () => {
  let service: LightroomService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(LightroomService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    // Fails the test if any HTTP call was made that we didn't explicitly expect.
    httpMock.verify();
    localStorage.clear();
  });

  describe('auth token storage', () => {
    it('setAuthToken stores the token in memory and localStorage', () => {
      service.setAuthToken('abc');

      expect(service.getAuthToken()).toBe('abc');
      expect(localStorage.getItem(TOKEN_KEY)).toBe('abc');
    });

    it('getAuthToken falls back to localStorage when memory is empty', () => {
      localStorage.setItem(TOKEN_KEY, 'from-storage');

      expect(service.getAuthToken()).toBe('from-storage');
    });

    it('getAuthToken returns null when nothing is stored', () => {
      expect(service.getAuthToken()).toBeNull();
    });

    it('clearAuthToken removes the token from memory and localStorage', () => {
      service.setAuthToken('abc');

      service.clearAuthToken();

      expect(service.getAuthToken()).toBeNull();
      expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    });
  });

  describe('loginHref', () => {
    it('returns the relative login path so it resolves under the deploy base-href', () => {
      expect(service.loginHref()).toBe('api/auth/login');
    });
  });

  describe('checkStatus', () => {
    it('GETs api/auth/status without an auth header when no token is set', () => {
      service.checkStatus().subscribe();

      const req = httpMock.expectOne('api/auth/status');
      expect(req.request.method).toBe('GET');
      expect(req.request.headers.has('X-Auth-Token')).toBe(false);
      req.flush({ authenticated: true });
    });

    it('includes the X-Auth-Token header when a token is set', () => {
      service.setAuthToken('tok-1');

      service.checkStatus().subscribe();

      const req = httpMock.expectOne('api/auth/status');
      expect(req.request.headers.get('X-Auth-Token')).toBe('tok-1');
      req.flush({ authenticated: true });
    });
  });

  describe('getPhotos', () => {
    it('GETs api/photos with a default limit of 20', () => {
      service.getPhotos().subscribe();

      const req = httpMock.expectOne((r) => r.url === 'api/photos');
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('limit')).toBe('20');
      req.flush({ resources: [] });
    });

    it('passes a custom limit through as a query param', () => {
      service.getPhotos(5).subscribe();

      const req = httpMock.expectOne((r) => r.url === 'api/photos');
      expect(req.request.params.get('limit')).toBe('5');
      req.flush({ resources: [] });
    });
  });

  describe('getPhotoBlob', () => {
    it('GETs the rendition URL with the size param and a blob responseType', () => {
      service.getPhotoBlob('asset-1', '640').subscribe();

      const req = httpMock.expectOne((r) => r.url === 'api/photos/asset-1/rendition');
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('size')).toBe('640');
      expect(req.request.responseType).toBe('blob');
      req.flush(new Blob());
    });

    it('defaults the size to 640 when not provided', () => {
      service.getPhotoBlob('asset-2').subscribe();

      const req = httpMock.expectOne((r) => r.url === 'api/photos/asset-2/rendition');
      expect(req.request.params.get('size')).toBe('640');
      req.flush(new Blob());
    });
  });

  describe('logout', () => {
    it('DELETEs api/auth/logout with the auth header', () => {
      service.setAuthToken('tok-1');

      service.logout().subscribe();

      const req = httpMock.expectOne('api/auth/logout');
      expect(req.request.method).toBe('DELETE');
      expect(req.request.headers.get('X-Auth-Token')).toBe('tok-1');
      req.flush(null);
    });
  });
});
