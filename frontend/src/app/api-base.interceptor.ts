import { HttpInterceptorFn } from '@angular/common/http';
import { backendBaseUri, isBundledApp } from './lightroom.service';

/** Whether a URL already names its own scheme, and so is not the browser's to resolve. */
function isAbsolute(url: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(url);
}

/**
 * Points the app's `api/...` calls at the backend when the page itself is not served by one.
 *
 * <p>Every call in {@link LightroomService} is written as a relative path, which the browser
 * resolves against the page. For the website and under `ng serve` that lands on the backend, because
 * the page comes from it. In the Android app the page is the bundle inside the APK, served from the
 * device — so `api/catalog` resolved to
 * `https://localhost/api/catalog`, and Capacitor's local server answered it with `index.html`.
 *
 * <p>A 200 of HTML, which is the worst shape this failure could take: not an error the app could
 * report, just JSON that would not parse, surfacing as "could not reach Lightroom" moments after a
 * sign-in that had in fact completely succeeded.
 *
 * <p>Only rewrites in that case. The website and the dev server keep resolving against the page,
 * which is how the dev server's proxy gets to do its job.
 */
export const apiBaseInterceptor: HttpInterceptorFn = (req, next) => {
  if (isAbsolute(req.url)) return next(req);
  if (!isBundledApp(document.baseURI, navigator.userAgent)) return next(req);
  return next(req.clone({ url: new URL(req.url, backendBaseUri()).href }));
};
