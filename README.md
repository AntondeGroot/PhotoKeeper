# PhotoKeeper
A tinder like app for your lightroom / photo folder

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