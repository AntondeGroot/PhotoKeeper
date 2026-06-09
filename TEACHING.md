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

---

## Remaining tasks — toward the interactive prototype

### Short term (core review flow)

**Task 9 — Progress bar** ← *currently in progress*
Show a progress bar above the card with "Today's batch · X / 15 today" and a fill bar driven by `progressPercent` computed. Teaches inline style binding `[style.width.%]`.

**Task 10 — Swipe gestures**
Add pointer event handling to `PhotoCardComponent` so the card can be dragged left (reject), right (keep), up (flag to edit), and down (in doubt). Shows drag offset overlays (← REJECT, KEEP →, etc.). Teaches pointer events, `@HostListener` or template event bindings, and CSS `transform`.

**Task 11 — AI hint chip**
Show a small chip below the action buttons when the current photo has an AI suggestion (e.g. "AI leans keep · Tack sharp, strong golden light"). Add an `ai` field to the `Photo` interface. Teaches optional fields (`ai?: ...`) and nested interfaces.

**Task 12 — Star and keepsake toggles**
Double-tap (or button) to toggle ★5 on a photo. A ♡/♥ keepsake toggle above the card. Both update the photo in the signal. Teaches event handling for double-tap.

**Task 13 — "In doubt" action**
Add a fourth action (swipe down / button) that sets status to `'maybe'`. Add it to the action bar and update the session done stats.

### Medium term (tabs and modes)

**Task 14 — Sort/Edit mode switcher**
A sub-tab bar inside Daily review that switches between Sort mode (what we have) and Edit mode (a list of photos flagged to edit). Teaches nested tab state.

**Task 15 — Edit queue (edit mode)**
Show the `toEdit` photos in a list with a "Edited → print" button per item. Clicking it sets status to `'toPrint'`.

**Task 16 — Pipeline tab**
Three lanes: To edit, To print, Done. Each lane groups photos by album. "Export ↗" action per album group. Teaches `@for` loops and grouping data in a computed.

**Task 17 — Settings tab**
Daily goal sliders (sort and edit), reminder time inputs, stereo tools toggle. Teaches two-way binding with `[(ngModel)]` and form inputs.

### Later (special card types)

**Task 18 — Burst card**
When the current item is a burst cluster, show the A/B duel UI instead of a swipe card. Teaches discriminated unions and `@switch` blocks.

**Task 19 — Panorama card**
Show the pano frames as a strip and treat the whole set as one swipeable card.

**Task 20 — Stereo workbench**
The most complex card — per-baseline keep/edit/reject decisions, 2D still option, fullscreen viewer.

---

## Known edge cases to revisit

- **Progress bar overshoots goal:** if `dailyGoal` is higher than the number of available photos, `progressPercent` never reaches 100% even after all photos are decided. Fix when real Lightroom photos are wired up — there'll always be more photos than the goal.

---

## How to resume after a session restart

1. Read this file (`TEACHING.md`) to understand the plan and where we left off.
2. Read `LEARNING.md` to see what concepts have already been explained — don't re-teach them.
3. Read `frontend/src/app/app.ts` and `app.html` to see the current state of the code.
4. Continue from the first incomplete task in the table above.