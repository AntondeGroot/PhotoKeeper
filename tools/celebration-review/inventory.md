# Celebration sheet inventory

21 files, 49 MB. 2 exact duplicate pairs → **19 unique sheets, ~505 tiles**.

Exact dupes (md5-identical, delete outright):
- `achievements3.png` == `achievements2.png`
- `celebrations6.png` == `celebrations5.png`

## Three style families

Nearly every sheet is 1536×1024 (standard ChatGPT landscape). They fall into three
incompatible visual languages:

**Style A — flat cartoon.** Soft shading, cream background, no scene border, character
floats free. Reads well small. Matches `mascot.png`.
→ mascot, achievements1, achievements4, achievements5, celebrations3, celebrations5,
celebrations7, celebrations8, reactions1, reactions2

**Style B — painterly vintage.** Heavy texture, ornate dark borders, rounded-rect scene
cards, detailed backgrounds. Rich but busy; detail is lost below ~200px.
→ achievements2, scenes1, celebrations, celebrations4, celebrations9, x, x2

**Style C — sepia storybook.** Loose watercolour, muted, scattered photos at the
character's feet, no border.
→ celebrations2, x3

## Redundancy clusters

**Cluster 1 — "achievement poses" — FIVE regenerations of one prompt.** Same ~30 poses in
the same grid slots (thumbs-up, confetti jump, flexing, crown, magnifier, sweeping, darkroom,
photo pile, box stack, album+glue, campfire, film-wrapped, rain cloud, shelf, gallery rope,
ninja, archaeologist, truck…). All Style A.
→ `achievements4`, `achievements5`, `celebrations5`, `celebrations7`, `celebrations8`
→ **Pick one sheet. Discard four (~140 tiles).**

**Cluster 2 — "holidays / special dates" — 4 versions across 3 styles.** Sinterklaas appears
in all four. Also Christmas, NYE fireworks, Valentine, St Patrick, Easter, Halloween,
Thanksgiving, Diwali, Hanukkah, Chinese New Year, Holi, Ramadan, Mid-Autumn, national days.
→ `celebrations` (B), `celebrations2` (C), `celebrations3` (A), `celebrations4` (B)
→ **Pick one. This is the special-dates set.**

**Cluster 3 — "backlog / archive narrative".** Climbing a mountain of albums, mining,
shredding, conveyor, vault, throne. Distinctive and on-theme for PhotoKeeper.
→ `celebrations9` (20), `x` (36), `x2` (44, captioned) — heavy mutual overlap

**Cluster 4 — reactions.** `reactions1` (5 tiles) is a subset of `reactions2` (7 tiles).
→ Keep `reactions2`, drop `reactions1`.

## Standalone sheets

- `mascot.png` — single hero, raccoon waving with a photo bucket. Clean. **Keep as-is**, no slicing.
- `achievements1` — 24 photography poses (tripod, drone, laptop, macro…). Style A. No overlap with Cluster 1.
- `achievements2` — 24 achievements **with baked-in labels**: "First Adventure / First photo with GPS",
  "Burst Master / Used burst mode", "Duplicate Hunter / Removed duplicates", "Touch Grass / No organizing for 7 days"…
- `scenes1` — 36 hobby vignettes (surfing, skateboarding, chemistry, guitar, bonsai, gym…).
  **No plausible app trigger for almost any of these** — this is the "will never be relevant" sheet.
- `x3` — 30 seasonal/occasion tiles, Style C. Contains **birthday cake** and **graduation**.

## The two captioned sheets are the caption dictionary

`achievements2` and `x2` have baked-in text laid out as art-on-top / caption-below, so the
text band crops off cleanly. Before cropping, they give us the *intended* caption for most
tiles in their families:

`x2` labels: Sleeping in a hollow tree · Reading by lantern light · Cozy cocoa & photos ·
His little archive cabin · Closed for today · Reaching new heights · Filing memories ·
Officially archived · Unlocking the vault · Archive complete! · Climbing the backlog ·
Halfway there… · One album at a time · Eyes on the summit · Album Everest Summit! ·
Worth every step · Rolling out the duplicates · Bulldozing clutter · Sweep it clean ·
Into the shredder · Feeding the firebox · Pull the lever · On the conveyor ·
Mining for memories · Full cart, happy heart · Overwhelmed · Where did all these come from? ·
We did it! · King of the Archive · Archive Dragon
Plus an edit-mode metaphor row: Hairdresser (trim the edges) · Tailor (fix the tears) ·
Painter (touch it up) · Jeweler (polish the gem) · Surgeon (precision work)

## Relevance triage

**Directly triggerable today** — session finished, backlog milestones (photos reviewed /
deleted counts), first session, streak, empty backlog. Cluster 1 + Cluster 3 cover these well.

**Triggerable from the calendar** — Cluster 2 holidays + birthday/graduation from `x3`.
Note the national-day tiles (USA, France, Germany, Canada, Mexico, Norway) only matter if
you localise; for a Dutch user Sinterklaas and King's Day are the ones that pay off.

**Not triggerable** — `scenes1` hobby vignettes, and achievements requiring metadata you
don't read (GPS, telephoto, night sky, macro, film imports, "photos from 25+ locations").

## Not yet checked

Per-tile artifact QC (bad hands, melted eyes, wrong-way flags) needs full-resolution
inspection of the *survivors*. Pointless before the style choice cuts the set.
