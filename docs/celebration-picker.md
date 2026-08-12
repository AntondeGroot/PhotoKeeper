# Celebration image picker

Which celebration image to show, and when. The artwork exists (see
`tools/celebration-review/`); nothing selects it yet.

This is the in-app image surface, distinct from the OS notification catalog in
`frontend/src/app/notifications/`. Same condition vocabulary, separate catalog —
notifications are title/body text, celebrations are a picture, and coupling them
means every new image drags a headline it does not need.

## Three axes, not one category

Every image answers three independent questions. Most of the apparent
complexity — "seasonal but random", "Valentine's but only once" — is just
different combinations of the same three fields.

| field | question | values |
| --- | --- | --- |
| `when` | when is it eligible at all? | `always` · date range · exact date · an event just happened · a counter crossed a threshold |
| `pick` | how does it compete? | `guaranteed` (claims the slot) · `random` (joins the pool) |
| `budget` | how often may it recur? | `once` ever · once per occurrence · once per year · cooldown of N days |

Worked examples:

| image | `when` | `pick` | `budget` |
| --- | --- | --- | --- |
| winter | range 21-12 → 20-03 (wraps the year) | random | cooldown ~3d |
| autumn | range 21-09 → 20-12 | random | cooldown ~3d |
| valentine | exact 14-02 | guaranteed | once per year |
| edited a photo | event `photoEdited` | random | cooldown |
| **first** album printed | event `albumPrinted` | guaranteed | once ever |
| album marked printed | event `albumPrinted` | random | per occurrence |
| 100 marked for deletion | threshold `deletedReaches: [50, 100, 500]` | guaranteed | once per threshold |
| panorama / telephoto | event | random | cooldown |

Note that "first album printed" is **not** a separate trigger — it is the same
`albumPrinted` event with `budget: once`. Every "first X" falls out of the budget
field, so there is no first-time mechanism to build.

## Selection

A two-stage ladder, run when a celebration slot opens:

1. **Claim.** Any eligible image with an unspent `guaranteed` claim? Show the
   narrowest one and mark the claim spent. This is what stops an exact-date image
   from being lost to chance.
2. **Pool.** Otherwise pick at random, weighted, from everything eligible.

Weight by how narrow the window is — exact date above season above `always`.
On 14 February both valentine and winter qualify; without weighting the seasonal
image drowns the special one, because it is eligible for ninety days against
valentine's one.

An image whose claim is already spent stays in the pool. That is the
"shown once, then random for the rest of the day" behaviour.

## Missed days: strict

If the app is not opened on 14 February, that year's valentine claim is simply
lost. No grace window, no catch-up the following day.

This is a decision, and it is also a simplification: the claim is keyed by
`(id, year)` and is only ever *consulted* on a date that matches the condition.
A missed date is never queried again, so nothing has to expire it — there is no
sweep, no pending-claim state, no "was this deferred" flag. Strictness costs an
occasional missed image and removes a whole category of bookkeeping.

Event-triggered images are unaffected: they wait for their event rather than for
a date.

## What it needs

A **shown-log** in on-device storage (see the `storage/` stores): per image id,
the last shown date and the number of times shown, plus spent claims keyed by
year or threshold. Without it `once`, `once per year` and cooldowns cannot work —
it is the only part of this that is not a plain field on a catalog entry.

The catalog itself maps id → filename, keyed on occasion, matching the naming
convention in `frontend/public/celebrations/README.md`. One TypeScript constant,
not a directory listing — the browser cannot enumerate a folder anyway.

## Reuse

`notifications/notification-message.ts` already carries most of the vocabulary:
`DateCondition`, `cooldownDays`, a `priority` override, and `DEFAULT_PRIORITY` as
a type ladder. `streakReaches: number[]` — "exactly one of these milestone days" —
is already the threshold-milestone pattern, so `deletedReaches: [50, 100, 500]`
reads as native.

`DateCondition` was extended on 2026-08-12 to cover everything the `when` axis
needs, so celebration entries can reuse it as-is:

- **`dd-MM`** recurs every year; **`dd-MM-yyyy`** fires in that year only. The
  pinned form is for dates that move — Koningsdag shifts to the 26th in years
  where the 27th is a Sunday, next in 2031.
- **A recurring range that ends before it starts wraps the new year.** Winter is
  authored once as `21-12` → `20-03`, no entry per year and no splitting it in
  two. Pinned ranges deliberately do not wrap: with absolute ends,
  end-before-start is a typo, and matching nothing surfaces that where wrapping
  would silently match almost every day.

Both forms are covered in `picker.spec.ts`. `koningsdag` was on `'14-02'`, the
same day as Valentine's, and now sits on `'27-04'`.
