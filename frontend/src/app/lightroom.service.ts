import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, tap } from 'rxjs';
import { PhotoAsset } from './lightroom-types';

const ACCESS_KEY = 'lr-access-token';
const REFRESH_KEY = 'lr-refresh-token';
const CATALOG_KEY = 'lr-catalog-id';

// The backend's own origin. Most calls go through the dev-server proxy as relative `api/...` URLs, but
// OAuth login is a full-page navigation that must hit the backend directly — on the same origin as the
// registered redirect-uri (the callback) — not whatever client port happens to serve the page.
const BACKEND_ORIGIN = 'https://localhost:8080';

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
    return `${BACKEND_ORIGIN}/api/auth/login`;
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

  /**
   * Fetches the *full* asset list of one album (backend follows Lightroom's pagination), unwrapped to
   * a flat array. Used by the background detection scan, which needs the complete population to find
   * bursts — unlike {@link getFeed}, which samples.
   */
  getAllAlbumAssets(albumId: string): Observable<PhotoAsset[]> {
    return this.http
      .get<{ resources: PhotoAsset[] }>(`api/albums/${albumId}/assets`, {
        headers: this.authHeaders(),
      })
      .pipe(map((res) => dedupeById(res.resources)));
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

  /**
   * Write-spike: ask the backend to ensure a Keeper album exists (and optionally add one asset), to
   * verify Lightroom album write-back against the real catalog. Returns the backend's report.
   */
  runAlbumSpike(name: string, assetId?: string): Observable<unknown> {
    const params: Record<string, string> = { name };
    if (assetId) params['assetId'] = assetId;
    return this.http.post('api/keeper/spike', null, { headers: this.authHeaders(), params });
  }

  /**
   * Write-spike: ask the backend to create a brand-new album via the API (as subtype "collection") and
   * report the subtype that actually stuck — to confirm whether an API-created album shows up as a normal
   * user album. Returns the backend's report.
   */
  runCreateAlbumSpike(name: string): Observable<unknown> {
    return this.http.post('api/keeper/spike/create-album', null, {
      headers: this.authHeaders(),
      params: { name },
    });
  }

  /**
   * Write-spike: ask the backend to set a star rating + pick/reject flag on one asset and report the
   * asset's payload before and after, to confirm per-asset review metadata write-back sticks in the real
   * catalog. Returns the backend's report.
   */
  runReviewSpike(rating: number, flag: string, assetId?: string): Observable<unknown> {
    const params: Record<string, string> = { rating: String(rating), flag };
    if (assetId) params['assetId'] = assetId;
    return this.http.post('api/keeper/spike/review', null, { headers: this.authHeaders(), params });
  }

  // Token + catalog id — for the data endpoints.
  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = { ...this.tokenHeaders() };
    const catalogId = this.getCatalogId();
    if (catalogId) headers['X-Catalog-Id'] = catalogId;
    return headers;
  }
}

/**
 * Keeps the first occurrence of each asset id. Lightroom's cursor pagination can repeat a boundary
 * asset across pages, and undeduped repeats inflate burst sizes (and `track`-by-id collapses them in
 * the UI), so detection must see each asset once.
 */
function dedupeById(assets: readonly PhotoAsset[]): PhotoAsset[] {
  const seen = new Set<string>();
  const unique: PhotoAsset[] = [];
  for (const asset of assets) {
    if (!seen.has(asset.id)) {
      seen.add(asset.id);
      unique.push(asset);
    }
  }
  return unique;
}

export interface Album {
  id: string;
  name: string;
}
