import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  // Reverse-DNS bundle identifier. Cheap to change now; painful once signing
  // certificates and installed copies on phones are tied to it.
  appId: "uk.antondegroot.photokeeper",
  appName: "PhotoKeeper",

  // Angular's production output, built with `--base-href /` because the app
  // serves it from the root of its own origin. This *is* the app: what ships in
  // the APK is what runs, which is why installing is a build step and not a
  // download of whatever happens to be deployed.
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
    // The app's own hostname, and so its origin: https://photokeeper. Capacitor's
    // default is `localhost`, which works but names the app after a convention of
    // the web rather than after itself — and the origin is not an implementation
    // detail: it is the key the engine files the app's whole database under, as
    // app_webview/Default/IndexedDB/https_photokeeper_0.indexeddb.leveldb.
    //
    // Changing it later moves that storage, so it is worth being the name you
    // want. It must also be listed in the backend's CorsConfig (ANDROID_ORIGIN),
    // which is why a change here needs a ./deploy.sh before the app can reach the
    // API again.
    hostname: "photokeeper",

    // No `url`, deliberately, and this is the decision the whole app shape rests
    // on. Setting it would point the webview at the deployed site, which would
    // make the app a viewer for whatever is on the Pi — a frontend change would
    // arrive by `./deploy.sh` and the APK would be a shell. Instead the bundle
    // above is the app, so `npm run android:install` puts the code you have
    // right now on the phone, and it opens with no network at all.
    //
    // It cannot be had both ways. Capacitor's local server answers *every*
    // request whose host matches the app's own (WebViewLocalServer.isMainUrl),
    // so an app serving its own bundle can never share an origin with the
    // backend — the api/... calls would come back as index.html. They are
    // therefore addressed absolutely: see backendBaseUri and apiBaseInterceptor
    // in the frontend, and ANDROID_ORIGIN in the backend's CorsConfig.
    //
    // The consequence worth knowing: the app's storage lives on
    // https://photokeeper, which is its own origin and so its own IndexedDB. The
    // website at antondegroot.uk keeps its own, separately.
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
