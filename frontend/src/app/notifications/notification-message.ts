/**
 * The message catalog + condition model for OS notifications (the "heads-up" nudges). Plain title /
 * text / icon, because the OS renders notifications itself — no HTML. Authored as small typed objects
 * in `catalog/` so conditions are type-checked (you can't typo a stat key). The picker (see picker.ts)
 * selects one message for the current {@link ReviewStats}; a Capacitor adapter sends it natively, and a
 * no-op web stub stands in for the PoC. In-app banners are a separate, celebration-only surface.
 */

import { LandingSpot } from './landing';

/** Which family a message belongs to — also its default selection priority (date > stat > evergreen). */
export type HeadsUpType = 'evergreen' | 'date' | 'stat';

/**
 * A calendar trigger. Single day, or an inclusive range.
 *
 * Each endpoint is `dd-MM`, which recurs every year, or `dd-MM-yyyy`, which fires in that year
 * only — for dates that move, like Koningsdag shifting to the 26th when the 27th is a Sunday.
 *
 * A recurring range whose end falls before its start wraps the new year, so winter is just
 * `21-12`→`20-03`. Pinned ranges do not wrap: with absolute ends, end-before-start is a typo.
 */
export type DateCondition = { onDate: string } | { fromDate: string; toDate: string };

/** A review-statistics trigger. A fixed vocabulary — not a general expression language. */
export type StatCondition =
  | { pileAtLeast: number } // unreviewed photos waiting ≥ n
  | { streakReaches: number[] } // current streak is exactly one of these milestone days
  | { editQueueAtLeast: number } // to-edit queue depth ≥ n
  | { printsAwaiting: true }; // there are arrived prints needing action

/** One catalog entry. `date`/`stat` are set according to `type`; evergreen has neither. */
export interface NotificationMessage {
  id: string; // stable, unique — the cooldown key
  type: HeadsUpType;
  icon: string; // a glyph/emoji (OS attaches the app icon; this is for the in-catalog preview)
  title: string; // may contain {{vars}} (see TEMPLATE_VARS)
  text: string; // may contain {{vars}}
  date?: DateCondition; // required when type === 'date'
  stat?: StatCondition; // required when type === 'stat'
  cooldownDays?: number; // don't re-show within this many days (default 0 = no cooldown)
  priority?: number; // overrides the type default when several qualify at once
  // Where tapping it should open the app. Omitted means the Sort step — what every message did
  // before this existed, and still the right answer for a plain "your photos are waiting".
  opensAt?: LandingSpot;
}

/** The live review context the picker evaluates conditions against and fills {{vars}} from. */
export interface ReviewStats {
  date: Date; // "today" — drives date conditions
  pileCount: number; // unreviewed photos waiting
  streak: number; // current daily-review streak, in days
  editQueue: number; // to-edit queue depth
  printsArrived: number; // arrived prints awaiting a "fill the album" action
}

/** A message resolved against the stats — ready to hand to a {@link NotificationSender}. */
export interface RenderedNotification {
  id: string;
  icon: string;
  title: string;
  text: string;
  /** Carried through from the message: where tapping this notification opens the app. */
  opensAt: LandingSpot;
}

/** The {{vars}} a message body may interpolate (the numeric fields of {@link ReviewStats}). */
export const TEMPLATE_VARS = ['pileCount', 'streak', 'editQueue', 'printsArrived'] as const;

/** Default selection priority when a message doesn't set one: date beats stat beats evergreen. */
export const DEFAULT_PRIORITY: Record<HeadsUpType, number> = { date: 3, stat: 2, evergreen: 1 };
