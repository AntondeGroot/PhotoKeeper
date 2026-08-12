# Celebration tile review

Tooling for turning the generated contact sheets in `sheets/` into a small,
stylistically consistent set of celebration images.

**None of this ships.** It lives outside `frontend/`, so the Angular build never
sees it — only `frontend/public/**` is copied into the bundle, and from there
into the backend jar and the APK. The finished, downsized images are what belong
in `frontend/public/celebrations/`; the 49 MB of source sheets, the sliced crops
and the full-size regenerated PNGs stay here.

Each sheet is a grid of dozens of mascot illustrations. This slices them into
individual tiles, lets you cull them down over several passes, and helps
regenerate the ones whose art style doesn't fit.

## Running it

```sh
cd tools/celebration-review
python3 build_crops.py     # sheets/ -> crops/ + tiles.js  (~15s, needs pillow + numpy)
python3 serve.py           # http://localhost:8777
```

Then open <http://localhost:8777/review.html>.

`build_crops.py` is safe to re-run: tile IDs are stable, so verdicts survive.

## The two pages

**`review.html`** — culling. Tiles arrive undecided; keep or cut each one.
Cut is permanent. Keep only survives the current *round* — start the next round
and every keeper comes back undecided, so it has to earn its place again. That
is how ~500 tiles get to a few dozen without one exhausting judgement call per
tile.

- **Focus** shows one tile large (1/2/3 at a time), `K` keep, `X` cut, `U` undo.
- **All** shows every tile in the round at once, for comparing across the set.
  Drag tiles to reorder them, or onto a group to file them together;
  ⌘/ctrl+click multi-selects and drags as a batch.
- Tiles show their **latest version**: once a regenerated image has been accepted
  on the restyle page it stands in for the original crop everywhere, marked
  `restyled`. One that is pasted but not yet judged is marked `pending` and still
  shows the original — it is a proposal, not a replacement.
- **`S`** flags a tile for restyling (`↻` on the card, or on the whole
  multi-selection at once). This is independent of keep/cut: a tile you are
  keeping can still need its art redone, which is the case worth catching. The
  `flagged for restyle` filter lists them, and they show up as rows on the
  restyle page.
- **Lock selection** writes the current keepers to `locked.json`, including which
  ones are flagged and which already have an accepted restyle.

**`restyle.html`** — style repair. Reads `locked.json` and `prompts.json` and
shows one row per off-style tile: the original, a paste target, and a prompt
that recreates that tile's subject in the target style. Copy the prompt, run it
through the image tool, paste the result back (⌘V onto the armed zone, or drop
a file), then judge the side-by-side:

- **Accept** (`A`) — the new one wins.
- **Redo** (`R`) — close, but try again. The image stays on screen so the next
  attempt is judged against the one you rejected. Fill in the row's *what to fix*
  note and it is appended to the prompt as a correction, so the retry differs
  from the attempt that missed; without it the same prompt tends to reproduce
  the same problem. **Copy redo prompts** takes the whole marked batch at once.
- **Decline** (`D`) — keep the original, stop trying.

**Replace image** arms a row that already has an image; pasting clears the
verdict so it gets judged fresh.

Rows come from `prompts.json`, plus any tile flagged for restyle in the review
page — flag with `S` there, reload here, and the row is waiting. No lock step:
this page reads the review page's storage directly. The **Flagged** filter shows
just your selection.

A newly flagged tile has no subject written for it yet, so its row gets an
editable subject field — fill it in, or ask for one to be written into
`prompts.json` from the artwork.

## Style

Three incompatible looks are mixed across the sheets — see `inventory.md`. The
target is **Style A**: flat cartoon on a plain cream ground, matching
`mascot.png`. `prompts.json` holds the shared style preamble plus a per-tile
subject description; edit it there rather than in the page.

## How the slicing works

Two strategies, chosen per sheet in `build_crops.py`:

- **blob** — connected components against the background. Right for sheets where
  characters float at irregular positions; on a regular grid it merges
  neighbours that touch.
- **band** — split on background gutters, rows first and then cells within each
  row. Right for the gridded sheets, and the only thing that recovers `x2`'s
  ragged 13-tile bottom row. On free-floating sheets it over-splits, slicing a
  character wherever a gap crosses it.

Band cuts are global, so a tile taller than its row gets clipped — Sinterklaas
lost the top of his mitre. `_reclaim` fixes that by flooding outward from the
cell's own pixels and taking whatever is connected, accepting an extension only
when it is a narrow protrusion rather than a full-width slab of the neighbour.

## What's tracked

`restyled/` holds images pasted back from the image tool — regenerate-only work,
so it is committed. `crops/` and `tiles.js` are derived and ignored.

Verdicts live in browser localStorage (`keeper-tile-review-v2`,
`keeper-restyle`), **not** on disk. Only `locked.json` and
`restyle-decisions.json` survive clearing the browser profile, so lock and save
when you've made progress worth keeping.