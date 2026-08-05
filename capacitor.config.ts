import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  // Reverse-DNS bundle identifier. Cheap to change now; painful once signing
  // certificates and installed copies on phones are tied to it.
  appId: "uk.antondegroot.photokeeper",
  appName: "PhotoKeeper",

  // Angular's production output, built with `--base-href /photokeeper/` so it
  // matches the deployed site. `server.url` below means this bundle is not what
  // actually renders — Capacitor simply requires webDir to exist, and this is
  // what the app would fall back to the day the remote URL is dropped.
  webDir: "frontend/dist/frontend/browser",

  android: {
    // Lets the web app recognise it is running inside the shell without pulling
    // @capacitor/core into a bundle that is otherwise served to plain browsers.
    // It uses this to ask the backend to end OAuth at the app rather than at the
    // website — see loginHrefUnder in frontend/src/app/lightroom.service.ts.
    appendUserAgent: "PhotoKeeperApp",

    // The app's own background colour (c-bg in frontend/src/styles.scss). Without
    // it the webview paints white while it fetches the remote URL below, which is
    // a white flash between the blanked-out launch window and the app's splash —
    // exactly the thing suppressing the native splash was meant to avoid.
    backgroundColor: "#131110",
  },

  server: {
    // PhotoKeeper is not a self-contained web app: every `api/...` call is
    // relative, and Adobe's OAuth callback redirects to the deployed frontend
    // URL with the tokens in the hash. Loading the deployed site directly keeps
    // both of those working unchanged — same origin for the API, and the
    // redirect lands back inside the app instead of navigating out of it.
    //
    // The cost is that the app needs the Pi to be reachable, and that a
    // `./deploy.sh` is picked up without reinstalling the APK.
    // Trailing slash on purpose: without it the request is answered by nginx's
    // 301 to the canonical path, and a webview caches a 301 for a long time —
    // one bad redirect (it briefly pointed at http://) then keeps breaking the
    // app long after the server is fixed. Asking for the canonical URL directly
    // sidesteps the whole redirect.
    url: "https://antondegroot.uk/photokeeper/",
    cleartext: false,

    // Capacitor keeps the webview on `url`'s host and hands anything else to the
    // system browser. OAuth is exactly that "anything else": login bounces
    // through Adobe IMS, so without these hosts the whole flow — including the
    // final redirect carrying the tokens — completes in Chrome, and the app is
    // left sitting on the logged-out page it started from.
    //
    // No allowNavigation, deliberately. Keeping Adobe's sign-in hosts in the
    // webview only half-worked: an Adobe ID stayed in the app, but a federated
    // account (Google, Behance) hopped to hosts that cannot be enumerated, and
    // Google refuses to authenticate inside an embedded webview at all. So the
    // whole flow now runs in the system browser — which is the recommended shape
    // for native OAuth anyway — and returns through photokeeper://auth, handled
    // by MainActivity.
  },
};

export default config;
