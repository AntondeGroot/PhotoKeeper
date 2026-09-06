# PhotoKeeper

A tinder like app for your lightroom / photo folder

## Installing on an Android phone

```bash
npm run android:install                  # build the APK and install it over USB
npm run android:install -- --skip-build  # reinstall the APK that is already built
```

Needs, once: JDK 21 (Temurin), the Android SDK platform-tools, and USB debugging
enabled on the phone. The script checks all three and says which one is missing
rather than failing inside Gradle or adb. `ANDROID_SERIAL` picks a phone when
more than one is attached.

**What the APK contains — and what it doesn't.** `capacitor.config.ts` sets
`server.url` to `https://antondegroot.uk/photokeeper`, so the installed app is a
native shell around the deployed site. That is deliberate: every `api/...` call
in the frontend is relative, and Adobe's OAuth callback redirects to the
deployed frontend URL with the tokens in the hash — loading the deployed origin
directly keeps both working with no code change.

The consequences are worth knowing:

- **Frontend changes need `./deploy.sh`, not a reinstall.** Reinstall only when
  the native shell changes: app id, name, icon, Capacitor version, or plugins.
- **The app needs the Pi to be reachable.** There is no offline mode; if the
  deploy is down the app shows a browser error page.

Making it a self-contained offline bundle later means dropping `server.url` and
then: an absolute backend base URL in `lightroom.service.ts`, CORS on the Spring
side for the webview origin, and a `photokeeper://` deep-link redirect for the
OAuth callback (a backend change).

## Photo sources

PhotoKeeper works over your **Lightroom** cloud catalog and (in a native/PWA build) the
**device's own photos**. Both can be read in full, which is what lets PhotoKeeper
background-scan for near-duplicates, bursts, panos, and stereo pairs.

**Google Photos cannot be used as a source — this is a hard limit, not a to-do.**
Google locked down its Photos API in 2025:

- The Library API's "read your whole library" scopes were **removed on 2025-03-31**; an
  app can now only see media **it uploaded itself**, never your existing photos.
- The replacement **Picker API only returns photos you manually hand-pick** in the Google
  Photos UI — there is no way to enumerate a library programmatically. So the background
  whole-library scanning PhotoKeeper is built around is impossible on Google Photos.
- **No Google Photos API can delete a photo** from your library either.

Because PhotoKeeper's whole value is scanning an entire library and routing decisions,
Google Photos is a non-starter. The realistic second source is the device's own photos.

## Lightroom write-back: what the API allows

PhotoKeeper reads your Lightroom catalog and lets you make decisions (keep/reject,
ratings, edit/print routing). A natural question is how much of that can be written
_back_ into Lightroom. The answer is: **very little** — and this is a hard limit of
Adobe's Lightroom partner API, not a PhotoKeeper shortcoming.

**You cannot change these in Lightroom from PhotoKeeper:**

- ⭐ **Star ratings** — no write endpoint exists.
- 🚩 **Pick / reject flags** — no write endpoint exists.
- 🎨 Color labels, and other per-asset review metadata — no write endpoint exists.

The partner API exposes rating and flag only as _read-side_ filters (you can list
"all rejected assets"), but offers no way to _set_ them. The asset endpoint is
create-only: trying to update an existing asset returns
`403 ResourceExistsError "duplicate asset already exists"`.

**The one durable write-back that _does_ work: adding an existing photo to an
existing album.** PhotoKeeper cannot create albums either (the partner API blocks
creating normal user albums), but it _can_ add photos to an album you made yourself.

**Adding is one-way: a photo cannot be taken out again.** Every removal shape was
probed against a real catalog:

| attempt                                | result                     |
| -------------------------------------- | -------------------------- |
| `DELETE /albums/{id}/assets` + body    | `403000 Forbidden`         |
| `DELETE /albums/{id}/assets?ids=`      | `403000 Forbidden`         |
| `DELETE /albums/{id}/assets/{assetId}` | `404 Resource not found`   |
| `PUT` marking the association removed  | ignored; treated as an add |

`403000` is the same generic code the rating write returns, so the endpoint exists
and this scope is simply not allowed to call it — a licensing boundary rather than a
missing feature, and one a different scope might lift. The 404 shows the per-membership
path is not the API's shape at all. Editing membership from the asset side is closed
too: any asset `PUT` is create-only.

**What that means in practice:** a photo whose verdict changes is _added_ to its new
album and stays in the old one. Sent to edit and later promoted to print, it appears in
both KeeperEdit and KeeperPrint. PhotoKeeper files the current verdict's album because
the alternative — not re-filing — would leave promoted photos missing from KeeperPrint,
which is worse than an untidy inbox you empty as you work.

**Adding is also not idempotent.** A photo already in the album is refused with
`403 ResourceExistsError "already in album"`, and one such member fails the whole write
with nothing applied. PhotoKeeper reads that refusal as success for a single-photo call,
and splits a rejected batch to retry one at a time — otherwise a single already-filed
photo would block its album for good.

### Recommended setup: make these albums in Lightroom first

So PhotoKeeper can route your decisions somewhere durable, create these albums in
Lightroom yourself (as normal albums), and PhotoKeeper will populate them:

- **`KeeperEdit`** — photos you want to edit
- **`KeeperDelete`** — photos you've rejected / want to delete
- **`KeeperPrint`** — photos you want to print

Anything that can't be written back (ratings, flags, the actual edits) is instead
handled by deep-linking you to the specific photo in Lightroom, and/or kept in
PhotoKeeper's own on-device store.

> This limitation is validated live in the **detection lab** (throwaway write-spike
> buttons): "Set ★5 + pick" reproduces the `duplicate asset` rejection, while the
> album write-spike succeeds — kept around so the boundary can be re-checked if the
> partner API ever changes.
