import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { Observable, catchError, finalize, shareReplay, switchMap, throwError } from 'rxjs';
import { isAuthFailure, LightroomService, TokenSet } from './lightroom.service';

const REFRESH_URL = 'api/auth/refresh';

/**
 * The refresh currently in flight, shared by every request waiting behind it.
 *
 * Module scope is the point. The interceptor function runs afresh per request, so a field on its
 * own frame would give each 401 a refresh of its own — and the app has many requests in the air at
 * once (the feed, the albums, every preview, the background scan). They all expire together, so
 * they all used to refresh together, each sending the same refresh token. Adobe rotates that token:
 * the first call through spent it, and the rest came back rejected and threw away the perfectly good
 * tokens the winner had just stored. A routine hourly expiry ended as a lost Lightroom session.
 */
let refreshInFlight: Observable<TokenSet> | null = null;

/**
 * Refreshes once no matter how many callers ask, handing them all the same result.
 *
 * Cleared when it settles, so the next expiry starts a new one — and replayed rather than re-run,
 * so a caller that arrives while it is still open gets the answer instead of a second request.
 */
function refreshOnce(svc: LightroomService): Observable<TokenSet> {
  refreshInFlight ??= svc.refresh().pipe(
    finalize(() => (refreshInFlight = null)),
    shareReplay({ bufferSize: 1, refCount: false }),
  );
  return refreshInFlight;
}

/** The original request, re-stamped with whatever token the refresh just stored. */
function withCurrentToken<T>(req: HttpRequest<T>, svc: LightroomService): HttpRequest<T> {
  return req.clone({ setHeaders: { 'X-Auth-Token': svc.getAccessToken() ?? '' } });
}

/**
 * On a 401, refreshes the access token and retries the request once.
 *
 * The session is given up only when Adobe itself rejects the refresh token — a 401 from
 * {@link REFRESH_URL}, which the backend reserves for exactly that. Every other way a refresh can
 * fail (IMS unreachable, the backend restarting mid-deploy, no connection) leaves the stored tokens
 * alone: they were never the problem, and signing in to Adobe again would not have fixed anything.
 */
export const authRefreshInterceptor: HttpInterceptorFn = (req, next) => {
  const svc = inject(LightroomService);
  if (req.url.includes(REFRESH_URL)) return next(req);

  return next(req).pipe(
    catchError((err: unknown) => {
      const is401 = err instanceof HttpErrorResponse && err.status === 401;
      if (!is401 || !svc.getRefreshToken()) return throwError(() => err);

      return refreshOnce(svc).pipe(
        catchError((refreshErr: unknown) => {
          if (isAuthFailure(refreshErr)) svc.loseSession();
          return throwError(() => refreshErr);
        }),
        // Outside the catch above on purpose: only the refresh's own verdict decides the session,
        // never how the retried request happens to fare afterwards.
        switchMap(() => next(withCurrentToken(req, svc))),
      );
    }),
  );
};
