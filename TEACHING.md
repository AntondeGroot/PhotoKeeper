# Keeper — Teaching plan

## The agreement

Anton is learning TypeScript and Angular by building the Keeper app.
The goal is to port the React prototype (`keeper-prototype.jsx`) into this Angular project, one small step at a time.

**Anton writes:** all TypeScript and HTML template code.
**Mentor (Claude) handles:** all CSS and styling, code reviews after each step, commit title suggestions, and the learning document.

**Rules:**
- One task at a time. Anton codes, mentor reviews, Anton commits, then next task.
- Mentor suggests improvements as code review feedback — never silently accepts a different approach.
- Mentor never writes TypeScript or HTML for Anton unprompted, even if asked. Explain the concept, let Anton write it.
- Purely aesthetic CSS changes are applied by the mentor without asking.
- Explaining *how* to show/hide things in HTML/CSS is fair game to teach.
- When Anton does something differently (naming, patterns), flag it as a suggested improvement.

**Key files:**
- `frontend/src/app/app.ts` — main component class
- `frontend/src/app/app.html` — main template
- `frontend/src/app/app.scss` — main styles
- `frontend/src/app/photo.ts` — Photo interface and mock data
- `frontend/src/app/photo-card/` — PhotoCard component
- `LEARNING.md` — Obsidian flashcard notes from each session
- `Downloads/keeper-prototype.jsx` — the React prototype to port
- `Downloads/keeper-design.md` — the full product design document

---

## Completed tasks

| # | Task | Commit |
|---|---|---|
| 1 | Shell with header, darkroom palette, and three-tab navigation | `feat: add Keeper shell with darkroom palette and tab navigation` |
| 2 | `Photo` interface and `MOCK_PHOTOS` array | `feat: add Photo interface and mock data` |
| 3 | Display first mock photo in review tab | `feat: display first mock photo in daily review tab` |
| 4 | Navigate between mock photos with prev/next | `feat: navigate between mock photos with prev/next controls` |
| 5 | Extract `PhotoCardComponent` as a standalone component | `feat: extract PhotoCard as a standalone component` |
| 6 | Style the photo card with the darkroom design | `feat: style photo card with darkroom design` |
| 7 | Keep/reject/edit action buttons with photo decisions | `feat: add keep/reject/edit action buttons with photo decisions` |
| 8 | Session done screen when all photos are reviewed | `feat: show session done screen when all photos are reviewed` |
| 9 | Progress bar with daily goal counter | `feat: add progress bar and daily goal counter to review tab` |
| 10 | Swipe gestures on PhotoCard | `feat: add swipe gestures to photo card` |
| 11 | AI hint chip | `feat: add AI hint chip to daily review` |
| 12 | Star and keepsake toggles | `feat: add star and keepsake toggles to review card` |
| 13 | "In doubt" action and maybe count in session done screen | `fix: align action buttons with prototype (star in bar, maybe swipe-only)` |
| 14 | Sort/Edit mode switcher | `feat: add Sort/Edit mode switcher to daily review tab` |
| 15 | Edit queue (edit mode) | `feat: add Sort/Edit mode switcher and edit queue to daily review` |
| 16 | Pipeline tab with album-grouped lists | `feat: add Pipeline tab with album-grouped to-edit and to-print lists` |
| 17 | Settings tab with goal sliders, presets, reminders, and localStorage persistence | `feat: add Settings tab with goal sliders, presets, reminders, and localStorage persistence` |

---

## Remaining tasks — toward the interactive prototype

### Completed

**Task 17 — Settings tab** ✓
Daily goal sliders (sort and edit), reminder time inputs, silent evening toggle. Persists to `localStorage` via `effect()`. Used `[value]` + `(input)` signal binding (not `ngModel`).

**Task 18 — Burst card** ✓
A/B duel UI for burst clusters. Introduced `ReviewItem` discriminated union, `@switch`/`@case`, `$any()` template escape hatch, type predicates in computed signals.

**Task 19 — Panorama card** ✓
Frame strip with swipe actions. Extended `ReviewItem` with `Pano`. Added `MOCK_PANO` and `@case ('pano')`.

**Task 20 — Stereo workbench** ✓
Per-baseline Keep/Edit/Reject buttons, "Also queue a 2D still" checkbox, "Done with this set" button disabled until all baselines decided. `verdicts` signal (`Record<string, verdict>`), `allChosen` computed, overall verdict rolled up in `confirm()`.

---

## Known edge cases to revisit

- **Progress bar overshoots goal:** if `dailyGoal` is higher than the number of available photos, `progressPercent` never reaches 100% even after all photos are decided. Fix when real Lightroom photos are wired up — there'll always be more photos than the goal.

---

## How to resume after a session restart

1. Read this file (`TEACHING.md`) to understand the plan and where we left off.
2. Read `LEARNING.md` to see what concepts have already been explained — don't re-teach them.
3. Read `frontend/src/app/app.ts` and `app.html` to see the current state of the code.
4. Continue from the first incomplete task in the table above.