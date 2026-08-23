import { Injectable, inject, isDevMode, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, map, tap } from 'rxjs';
import { PhotoAsset } from './lightroom-types';

const ACCESS_KEY = 'lr-access-token';
const REFRESH_KEY = 'lr-refresh-token';
const CATALOG_KEY = 'lr-catalog-id';
// Survives the tokens on purpose: it is how a returning user is told apart from a first-run one, so
// the app knows to offer "connect again" rather than silently behaving as if Lightroom was never set
// up. Only an explicit Disconnect removes it.
const HAD_SESSION_KEY = 'lr-had-session';

// Under `ng serve` the page is on the dev-server port while the backend is on 8080. The proxy cannot
// help here: OAuth login is a full-page navigation, and Adobe sends the browser back to the origin
// named by the registered redirect-uri — the backend's — so login has to start there too.
const DEV_BACKEND_ORIGIN = 'https://localhost:8080';

// Appended to the user agent by the Android shell (see capacitor.config.ts). The shell cannot finish
// OAuth in its own webview — Google refuses to authenticate inside one — so sign-in runs in the
// system browser, and the backend has to be told to deliver the tokens back to the app's custom
// scheme rather than to the website the browser is already sitting on.
const NATIVE_SHELL_UA = 'PhotoKeeperApp';

/**
 * Absolute URL that starts the OAuth flow, resolved against whichever base the backend answers on.
 * It has to be absolute because this is a full-page navigation rather than an XHR, and it has to
 * follow the base rather than assume a host: deployed, the app lives under a path prefix
 * (`/photokeeper/`), and the Android shell loads that same deployed URL.
 */
export function loginHrefUnder(backendBaseUri: string, userAgent: string): string {
  const url = new URL('api/auth/login', backendBaseUri);
  if (userAgent.includes(NATIVE_SHELL_UA)) {
    url.searchParams.set('client', 'app');
  }
  return url.href;
}

/** Where the backend answers: its own origin under `ng serve`, otherwise wherever it serves the app. */
function backendBaseUri(): string {
  return isDevMode() ? `${DEV_BACKEND_ORIGIN}/` : document.baseURI;
}

/** Token set returned by the backend (device-stored). */
export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * Whether a failure means the Lightroom session is genuinely no good, as opposed to the backend
 * being unreachable for a moment.
 *
 * The distinction is the difference between "sign in to Adobe again" and "try again in a second".
 * A deploy restarts the backend, so a 502 on the first call after one is routine — and treating
 * that as an expired session throws away credentials that were perfectly valid.
 *
 * 401 and nothing else, deliberately. The backend answers with exactly one status when a token is
 * genuinely spent, and never produces a 403 of its own — so a 403 can only have come from something
 * in front of it: a proxy, a WAF, a CORS rule. This used to accept 403 too, and a CORS rule that
 * omitted the deployed origin then rejected every `POST /api/auth/refresh` before it reached the
 * controller. The device read that as Adobe refusing the token and signed the user out, daily,
 * while nothing was wrong with their credentials at all.
 *
 * Only meaningful after {@link authRefreshInterceptor} has already tried to refresh: by the time an
 * error reaches here, a recoverable token has been recovered.
 */
export function isAuthFailure(err: unknown): boolean {
  return err instanceof HttpErrorResponse && err.status === 401;
}

@Injectable({ providedIn: 'root' })
export class LightroomService {
  private readonly http = inject(HttpClient);

  /**
   * A Lightroom session the user had is gone, and only signing in to Adobe again brings it back.
   *
   * Raised rather than acted on here, because losing a session is a thing the whole app has to
   * notice: it used to be a quiet `localStorage` delete inside an HTTP interceptor, which left the
   * UI showing a connected Lightroom that answered nothing.
   */
  readonly sessionLost = signal(false);

  /**
   * A verified, working Lightroom session — the token has been proved against the catalog, not just
   * found in storage. The one answer to "does Lightroom answer right now", so that a session ending
   * anywhere (boot, an interceptor mid-swipe, Settings → Disconnect) stops the whole app talking to
   * it. It used to be the host component's own flag, which an interceptor had no way to lower.
   */
  readonly connected = signal(false);

  loginHref(): string {
    return loginHrefUnder(backendBaseUri(), navigator.userAgent);
  }

  // ── Device-stored tokens + catalog id ───────────────────────────────────────
  setTokens(accessToken: string, refreshToken: string): void {
    localStorage.setItem(ACCESS_KEY, accessToken);
    localStorage.setItem(REFRESH_KEY, refreshToken);
    localStorage.setItem(HAD_SESSION_KEY, 'true');
    this.sessionLost.set(false);
  }

  /** Whether this device has ever held a Lightroom session, tokens or no tokens. */
  hadSession(): boolean {
    return localStorage.getItem(HAD_SESSION_KEY) !== null;
  }

  /**
   * At startup: whether there is a session to work with, noticing a lost one on the way.
   *
   * `sessionLost` lives in memory and cannot survive a restart, so a session dropped in an earlier
   * run leaves nothing behind but the absence of tokens next to a device that has connected before.
   * Boot is the only place that reads as "lost", and without this the prompt would be shown only to
   * whoever happened to still have the app open when it happened.
   */
  resumeSession(): boolean {
    if (this.getAccessToken()) return true;
    if (this.hadSession()) this.loseSession();
    return false;
  }

  /**
   * Drops a session that cannot be recovered and asks the app to prompt for sign-in.
   *
   * The prompt is owed only to someone who had a session to lose; a user who never connected
   * Lightroom is not told that something has expired.
   */
  loseSession(): void {
    const hadSession = this.hadSession();
    this.clearTokens();
    this.connected.set(false);
    this.sessionLost.set(hadSession);
  }

  /**
   * Forgets Lightroom entirely — Settings → Disconnect. Deliberately not {@link loseSession}: the
   * user chose this, so there is nothing to warn them about and nothing to prompt them to restore.
   */
  forgetSession(): void {
    this.clearTokens();
    localStorage.removeItem(HAD_SESSION_KEY);
    this.connected.set(false);
    this.sessionLost.set(false);
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
