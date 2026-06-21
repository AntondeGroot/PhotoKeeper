# Android app attempt — learnings (2026-06-15)

We tried wrapping the PhotoKeeper Angular frontend in a native Android app using
[Capacitor](https://capacitorjs.com/). It didn't fully work yet, so we reverted the
Android-specific pieces. This document records the settings and gotchas we discovered so
the next attempt starts from a known baseline instead of from scratch.

**What we kept:** the web-deployment path (Angular built and served from Spring Boot on the
Raspberry Pi behind a Cloudflare Tunnel). That works and is independent of the native app.
See `deploy.sh`.

**What we reverted:** everything Capacitor/Android-native (see "Reverted changes" below).

---

## Why it didn't work yet

The core problem is the **OAuth login round-trip inside a native WebView**. The flow is:

```
app → /api/auth/login → Adobe IMS login → callback → backend → redirect back to app with token
```

Inside `capacitor://localhost` (or `https://localhost`) the WebView origin is not a real web
origin Adobe knows about, and the redirect back into the app does not cleanly re-enter the
Angular bundle. The login either escapes into an external Chrome tab or fails to deliver the
token back to the app. We did not get an end-to-end authenticated session on-device.

---

## Settings we learned (keep these for the next attempt)

### 1. Capacitor config (`frontend/capacitor.config.ts`)

```ts
const config: CapacitorConfig = {
  appId: 'com.photokeeper.app',
  appName: 'PhotoKeeper',
  webDir: 'dist/frontend/browser',     // Angular's build output dir
  server: {
    androidScheme: 'https',            // serves the app from https://localhost, not http
    // Keep the Pi + Adobe login inside the WebView so the full OAuth flow stays in-app.
    allowNavigation: ['antondegroot.uk', '*.adobelogin.com'],
  },
};
```

- `webDir` must point at `dist/frontend/browser` (Angular 17+ application builder layout).
- `androidScheme: 'https'` makes the WebView origin `https://localhost`. With the default
  (`http`) the origin is `http://localhost` and mixed-content / cookie rules bite harder.
- `allowNavigation` was our attempt to keep Adobe login in the WebView. Still insufficient
  for a clean token hand-back — this is the main unsolved area.

### 2. CORS (backend `CorsConfig.java`)

The native WebView makes API calls from a non-localhost-6200 origin, so the backend must
allow the WebView origins:

```java
.allowedOrigins(
    "http://localhost:6200",   // Angular dev server
    "https://localhost",       // Capacitor WebView (androidScheme: 'https')
    "capacitor://localhost")   // Capacitor WebView (default scheme)
```

### 3. API base URL switching (`frontend/lightroom.service.ts`)

On the web the frontend and API share an origin, so relative URLs work. In the native app
there is no backend at `localhost`, so calls must target the hosted Pi:

```ts
import { Capacitor } from '@capacitor/core';
const API_BASE = Capacitor.isNativePlatform()
  ? 'https://antondegroot.uk/photokeeper'
  : '';
```

The login link needs the same treatment (it's a full-page navigation, not an XHR), which is
why `loginHref()` was added to the service and bound in `app.html`.

> Note: the *relative-URL* change (`api/...` instead of `/api/...`) is also required by the
> web deploy because the app is served under the `/photokeeper` context path. That part was
> kept; only the `Capacitor.isNativePlatform()` branch was native-specific.

### 4. Build & toolchain

- **APK build needs Java 21.** Gradle 8.x (Capacitor's Android template) refuses Java 17/24.
  Use `/usr/libexec/java_home -v 21`.
- **Android SDK** is expected at `$HOME/Library/Android/sdk` (installed via Android Studio);
  export it as `ANDROID_HOME`.
- Build the Angular bundle for the APK with `--base-href /` so the in-app assets load from
  `capacitor://localhost`, *not* the `/photokeeper/` base-href used for the Pi web build.
  Two different base-hrefs for two different targets — this tripped us up.
- `npx cap sync android` copies the built web assets + plugins into `frontend/android/`.
- `frontend/android/` is fully generated (`npx cap add android`) and should stay gitignored.

### 5. Dependency / tooling friction

- `@capacitor/cli` pulled in tooling that conflicted with our ESLint 10; we had to downgrade
  `@eslint/js` to `^9.0.0` to install. (Reverted back to `^10.0.1`.)
- ESLint needed `android/**` ignored and `capacitor.config.ts` added to
  `allowDefaultProject` so it didn't try to type-check generated/config files.

### 6. APK distribution

We added a `/download` install page (`download.html` + `DownloadController`) and had
`deploy.sh` bundle `photokeeper.apk` into the backend's static resources, so the Pi could
serve the APK directly. This part worked mechanically.

**Kept:** the `/download` page and its controller — the download button is disabled
("coming soon") until there's a working APK again.
**Reverted:** the APK build + bundling steps in `deploy.sh`.

---

## What to try next time

1. **Solve the OAuth hand-back first**, in isolation, before re-wrapping the whole app. Most
   promising: Capacitor's `@capacitor/browser` (system browser / Custom Tabs) plus a deep
   link / App URL scheme (`com.photokeeper.app://callback`) so Adobe redirects back into the
   app with the token, instead of trying to keep Adobe login inside the WebView.
2. Register the deep-link redirect URI in the Adobe IMS app config.
3. Only after a token reliably lands in the app, rebuild the APK and re-test the API calls.

---

## Reverted changes (for reference)

| File | Android-specific change removed |
| --- | --- |
| `frontend/capacitor.config.ts` | deleted |
| `frontend/android/` | deleted (generated project) |
| `frontend/package.json` + lock | `@capacitor/{android,core,cli}` deps removed (restored from `main`) |
| `frontend/eslint.config.js` | `android/**` ignore; `capacitor.config.ts` allowDefaultProject |
| `.gitignore` | `frontend/android/` |
| `backend/.../CorsConfig.java` | `https://localhost`, `capacitor://localhost` origins |
| `deploy.sh` | APK build + bundling steps |
| `backend/src/main/resources/download.html` | download button disabled (page kept) |
| `frontend/src/app/{app.ts,app.html,lightroom.service.ts}` | `Capacitor.isNativePlatform()` API switching, `loginHref` — **pending, TS by hand** |