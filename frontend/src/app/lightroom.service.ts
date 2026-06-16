import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, tap } from 'rxjs';

const ACCESS_KEY = 'lr-access-token';
const REFRESH_KEY = 'lr-refresh-token';
const CATALOG_KEY = 'lr-catalog-id';

/** Token set returned by the backend (device-stored). */
export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

@Injectable({ providedIn: 'root' })
export class LightroomService {
  private readonly http = inject(HttpClient);

  loginHref(): string {
    return 'api/auth/login';
  }

  // ── Device-stored tokens + catalog id ───────────────────────────────────────
  setTokens(accessToken: string, refreshToken: string): void {
    localStorage.setItem(ACCESS_KEY, accessToken);
    localStorage.setItem(REFRESH_KEY, refreshToken);
  }

  getAccessToken(): string | null {
    return localStorage.getItem(ACCESS_KEY);
  }

  getRefreshToken(): string | null {
    return localStorage.getItem(REFRESH_KEY);
  }

  clearTokens(): void {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(CATALOG_KEY);
  }

  getCatalogId(): string | null {
    return localStorage.getItem(CATALOG_KEY);
  }

  /** Exchanges the stored refresh token for a fresh token set (and stores it). */
  refresh(): Observable<TokenSet> {
    return this.http
      .post<TokenSet>('api/auth/refresh', { refreshToken: this.getRefreshToken() })
      .pipe(tap((tokens) => this.setTokens(tokens.accessToken, tokens.refreshToken)));
  }

  /** Fetches the user's catalog id once and caches it for subsequent requests. */
  loadCatalogId(): Observable<string> {
    return this.http.get<{ id: string }>('api/catalog', { headers: this.tokenHeaders() }).pipe(
      map((catalog) => catalog.id),
      tap((id) => localStorage.setItem(CATALOG_KEY, id)),
    );
  }

  // ── Data ────────────────────────────────────────────────────────────────────
  getAlbums(): Observable<Album[]> {
    return this.http.get<Album[]>('api/albums', { headers: this.authHeaders() });
  }

  getFeed(vacationAlbumIds: string[], limit = 20): Observable<{ resources: PhotoAsset[] }> {
    return this.http.get<{ resources: PhotoAsset[] }>('api/feed', {
      headers: this.authHeaders(),
      params: { vacationAlbums: vacationAlbumIds.join(','), limit },
    });
  }

  getPhotoBlob(assetId: string, size = '640'): Observable<Blob> {
    return this.http.get(`api/photos/${assetId}/rendition`, {
      headers: this.authHeaders(),
      params: { size },
      responseType: 'blob',
    });
  }

  logout(): Observable<void> {
    return this.http.delete<void>('api/auth/logout');
  }

  // Token-only header — for /catalog, which is how we *get* the catalog id.
  private tokenHeaders(): Record<string, string> {
    const token = this.getAccessToken();
    return token ? { 'X-Auth-Token': token } : {};
  }

  // Token + catalog id — for the data endpoints.
  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = { ...this.tokenHeaders() };
    const catalogId = this.getCatalogId();
    if (catalogId) headers['X-Catalog-Id'] = catalogId;
    return headers;
  }
}

export interface PhotoAsset {
  id: string;
  subtype: string;
  album?: string;
  payload?: {
    captureDate?: string;
    userCreated?: string;
    importSource?: { fileName?: string };
  };
}

export interface Album {
  id: string;
  name: string;
}
