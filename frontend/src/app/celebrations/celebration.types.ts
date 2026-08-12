import { DateCondition } from '../notifications/notification-message';

/**
 * The celebration-image model: which picture to show when a celebration slot opens.
 *
 * Design in `docs/celebration-picker.md`. Each image answers three questions, and most of the
 * apparent complexity ("seasonal but random", "Valentine's but only once") is just different
 * combinations of them:
 *
 * - **when** it is eligible at all — {@link CelebrationTrigger}
 * - **how it competes** once eligible — {@link CelebrationImage.guarantee}
 * - **how often it may recur** — {@link CelebrationImage.cooldownDays} / `maxShows`
 *
 * Calendar conditions are the same `dd-MM` / `dd-MM-yyyy` vocabulary the notification catalog
 * uses, reused rather than reinvented. Notifications are OS text and celebrations are a picture,
 * so the catalogs stay separate.
 */

/** Something the app can tell us just happened. Emitted at the moment of the action. */
export type CelebrationEvent =
  'photoEdited' | 'albumPrinted' | 'panoramaCompleted' | 'stereoViewed' | 'sessionFinished';

/** A running total the app keeps. Milestones fire as one of these crosses a listed threshold. */
export type CelebrationCounter =
  'photosReviewed' | 'photosDeleted' | 'photosEdited' | 'albumsPrinted' | 'streakDays';

/**
 * A milestone on a running total.
 *
 * `reaches` is a fixed ladder, for occasions that genuinely happen once — your first printed album.
 * `every` repeats forever at each multiple, which is what anything ongoing wants: a fixed ladder
 * goes quiet the moment you pass its last rung, and someone who edits a thousand photos should not
 * be celebrated less than someone who edits fifty.
 *
 * Either way the milestone is the highest one **crossed**, not one landed on exactly. Totals are
 * only read when a slot opens, so a session that takes you from 95 to 107 has to still count as
 * reaching 100 — otherwise milestones are missed silently and at random.
 */
export type CounterTrigger =
  | { counter: CelebrationCounter; reaches: number[] }
  | { counter: CelebrationCounter; every: number };

/** When an image is eligible. */
export type CelebrationTrigger =
  { always: true } | { date: DateCondition } | { event: CelebrationEvent } | CounterTrigger;

/**
 * How an image claims the slot rather than taking its chances in the pool.
 *
 * Absent means "join the random pool". Present means "if eligible and the claim is unspent, show
 * this and nothing else" — the mechanism that stops an exact-date image being lost to chance.
 * The scope says how often the claim renews:
 *
 * - `once` — ever. "First album printed."
 * - `perYear` — once each calendar year. Valentine's.
 * - `perThreshold` — once per counter milestone, so 50 / 100 / 500 each get their moment.
 */
export type GuaranteeScope = 'once' | 'perYear' | 'perThreshold';

/** One catalog entry. `id` is stable and is the shown-log key; `file` is relative to `/celebrations/`. */
export interface CelebrationImage {
  id: string;
  file: string;
  when: CelebrationTrigger;
  guarantee?: GuaranteeScope;
  /** Don't show again within this many days once it has been shown. Default 0 = no limit. */
  cooldownDays?: number;
  /** Hard cap on total showings. 1 makes it a one-off even after its claim is spent. */
  maxShows?: number;
}

/** The live context a trigger is evaluated against. */
export interface CelebrationContext {
  date: Date;
  /** What just happened, if this slot was opened by an action rather than by the calendar. */
  event?: CelebrationEvent;
  /** Current totals. A counter that isn't tracked yet is simply absent. */
  counters?: Partial<Record<CelebrationCounter, number>>;
}

/** What the shown-log remembers per image. */
export interface ShownRecord {
  /** Epoch ms of the most recent showing, for cooldowns. */
  lastShown: number;
  /** Total showings, for `maxShows`. */
  count: number;
  /**
   * Guarantee claims already spent, as opaque scope keys — `'once'`, a year (`'2026'`), or a
   * counter milestone (`'photosDeleted:100'`). Storing the key rather than a flag is what lets one
   * image renew annually while another fires once per milestone, with no per-scope bookkeeping.
   */
  claims: string[];
}

/** id → what we know about showing it. Absent means never shown. */
export type ShownLog = Record<string, ShownRecord>;

/**
 * A chosen image, resolved for display — the id (for logging or debugging) and a `src` the template
 * can bind straight to. Mirrors how the notification picker hands back a rendered message rather
 * than a catalog entry, so the component never has to know where the artwork lives.
 */
export interface PickedCelebration {
  id: string;
  src: string;
}

/**
 * The pick standing for the current session, remembered so that closing the app and coming back
 * shows the same picture rather than rolling again.
 *
 * `id` is null when the session was already decided and nothing qualified — worth recording, so a
 * restart doesn't keep retrying a draw that has no candidates. Only the id is kept: the path comes
 * from the catalog, so artwork can be renamed without stranding a stored URL.
 */
export interface CurrentPick {
  sessionKey: string;
  id: string | null;
}
