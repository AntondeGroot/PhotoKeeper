import { HttpRequest, HttpResponse } from '@angular/common/http';
import { of } from 'rxjs';
import { apiBaseInterceptor } from './api-base.interceptor';

const SHELL_UA =
  'Mozilla/5.0 (Linux; Android 15) Chrome/150.0.0.0 Mobile Safari/537.36 PhotoKeeperApp';
const BROWSER_UA = 'Mozilla/5.0 (Linux; Android 15) Chrome/150.0.0.0 Mobile Safari/537.36';

/** Runs the interceptor and reports the URL the request would actually be sent to. */
function urlAfterInterceptor(url: string): string {
  let seen = '';
  const next = (req: HttpRequest<unknown>) => {
    seen = req.url;
    return of(new HttpResponse());
  };
  apiBaseInterceptor(new HttpRequest('GET', url), next).subscribe();
  return seen;
}

/** Pretends the page is the bundle inside the APK, or the deployed site. */
function servedFrom(baseUri: string, userAgent: string): void {
  vi.spyOn(document, 'baseURI', 'get').mockReturnValue(baseUri);
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
}

describe('apiBaseInterceptor', () => {
  afterEach(() => vi.restoreAllMocks());

  /**
   * The failure this exists for. A relative path resolves against the page, and in the APK the page
   * is served from the device — so the call reached Capacitor's local server, which answered it with
   * index.html. A 200 of HTML is the worst shape it could take: not an error the app could report,
   * just JSON that would not parse, surfacing as a broken session right after a successful sign-in.
   */
  it('sends the app bundle’s api calls to the backend, not to the device', () => {
    servedFrom('https://photokeeper/', SHELL_UA);

    expect(urlAfterInterceptor('api/catalog')).toBe(
      'https://antondegroot.uk/photokeeper/api/catalog',
    );
  });

  it('leaves the deployed site resolving against its own page', () => {
    servedFrom('https://antondegroot.uk/photokeeper/', SHELL_UA);

    expect(urlAfterInterceptor('api/catalog')).toBe('api/catalog');
  });

  /** A browser on localhost is the dev server, whose proxy is what forwards /api to the backend. */
  it('leaves a plain browser alone, so the dev proxy still does its job', () => {
    servedFrom('http://localhost:6200/', BROWSER_UA);

    expect(urlAfterInterceptor('api/catalog')).toBe('api/catalog');
  });

  it('never rewrites a URL that already names its own host', () => {
    servedFrom('https://photokeeper/', SHELL_UA);

    expect(urlAfterInterceptor('https://lr.adobe.io/v2/catalog')).toBe(
      'https://lr.adobe.io/v2/catalog',
    );
  });
});
