import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';
import { LightroomService } from './lightroom.service';

/**
 * On a 401, transparently refreshes the access token and retries the request once. If the refresh
 * itself fails (refresh token expired/revoked), the device's tokens are cleared so the app falls
 * back to the login screen.
 */
export const authRefreshInterceptor: HttpInterceptorFn = (req, next) => {
  const svc = inject(LightroomService);
  const isRefreshCall = req.url.includes('api/auth/refresh');

  return next(req).pipe(
    catchError((err: unknown) => {
      const is401 = err instanceof HttpErrorResponse && err.status === 401;
      if (!is401 || isRefreshCall || !svc.getRefreshToken()) {
        return throwError(() => err);
      }
      return svc.refresh().pipe(
        switchMap(() =>
          next(req.clone({ setHeaders: { 'X-Auth-Token': svc.getAccessToken() ?? '' } })),
        ),
        catchError((refreshErr: unknown) => {
          svc.clearTokens();
          return throwError(() => refreshErr);
        }),
      );
    }),
  );
};
