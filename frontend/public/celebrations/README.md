# Celebration images

Static images shown to reward the user — after finishing a daily review session,
or on a special date (birthday, holiday, milestone).

Everything under `frontend/public/` is copied to the web root by the Angular
build (see `angular.json` → `assets`), so a file at

    frontend/public/celebrations/session-done/streak-7.webp

is served at

    /celebrations/session-done/streak-7.webp

That same path works in the Android build too: `npx cap sync` copies the built
`dist/` output into `android/app/src/main/assets/public/`.

## Folders

- `session-done/` — shown on the "you're done for today" screen
  (`src/app/review/session-done/`).
- `special-dates/` — shown on a specific calendar date.

## Conventions

- **Format**: `.webp` preferred (`.png` if transparency matters, `.jpg` for
  photos). Avoid `.gif`; use a static frame plus CSS if you need motion.
- **Size**: keep each file well under ~200 KB. These ship inside the app bundle
  and count toward the production budget in `angular.json` only if imported from
  code — referenced by URL they don't, but they do inflate the APK.
- **Dimensions**: ~1080px on the long edge is plenty for a phone-sized card.
- **Naming**: lowercase kebab-case, descriptive of the occasion rather than the
  content — e.g. `streak-7.webp`, `first-session.webp`, `new-year.webp`,
  `birthday.webp`. The filename is what the (future) picker logic will key on.

## Where the artwork comes from

Everything in this folder ships — it is copied verbatim into the bundle, the
backend jar and the APK. So only finished, downsized images belong here.

The raw contact sheets and the tooling that slices, culls and regenerates them
live in `tools/celebration-review/`, outside the build. **Do not hand-edit the
images here**: they are written by

    cd tools/celebration-review && python3 export_to_app.py

which takes the chosen tiles, downsizes each to ≤1080px webp under 200 KB, and
writes it under the name the picker keys on. Re-running overwrites by name, so
redoing a single image means restyling it in the tool and exporting again.
`tools/celebration-review/exported.json` records which tile each file came from.

The current set is 58 images, ~2 MB. Note that the ones never regenerated are
sliced straight out of a contact sheet and so are only 200–550px on the long
edge — fine small, soft if shown full-width.

## Not wired up yet

Nothing reads this folder at the moment. When it gets wired up, the mapping from
occasion → filename should live in a single TypeScript constant rather than
being derived from directory listings (the browser can't list them anyway).
