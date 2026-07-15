# PhotoKeeper
A tinder like app for your lightroom / photo folder

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

- **`PhotokeeperEdit`** — photos you want to edit
- **`PhotokeeperDelete`** — photos you've rejected / want to delete
- **`PhotokeeperPrint`** — photos you want to print

Anything that can't be written back (ratings, flags, the actual edits) is instead
handled by deep-linking you to the specific photo in Lightroom, and/or kept in
PhotoKeeper's own on-device store.

> This limitation is validated live in the **detection lab** (throwaway write-spike
> buttons): "Set ★5 + pick" reproduces the `duplicate asset` rejection, while the
> album write-spike succeeds — kept around so the boundary can be re-checked if the
> partner API ever changes.