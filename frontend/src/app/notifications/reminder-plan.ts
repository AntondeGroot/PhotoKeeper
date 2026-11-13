import { RenderedNotification } from './notification-message';
import { LandingSpot } from './landing';

/**
 * How many days ahead the reminders are laid out.
 *
 * Each reminder is a dated one-off rather than a daily repeat, because a repeat cannot skip a day:
 * the only way to say "not today, I'm done — but tomorrow as usual" to the OS is to have scheduled
 * tomorrow separately. The cost is that the run ends: without the app being opened, reminders stop
 * after this many days. Every open lays out a fresh run, so that only bites someone who has not
 * opened the app for a fortnight.
 */
export const DAYS_AHEAD = 14;

/**
 * OS notification ids: one per slot per day ahead, so re-planning reuses them and the OS *replaces*
 * a pending alarm instead of stacking a second one behind it. Day 0 is today.
 */
const MORNING_ID_BASE = 100;
const EVENING_ID_BASE = 200;

/**
 * The daily-repeating alarms earlier builds scheduled. Still cancelled on every pass: a repeating
 * alarm re-arms itself, so one left behind would keep firing alongside the dated ones for good.
 */
const LEGACY_REPEATING_IDS = [1, 2];

const dayOffsets = Array.from({ length: DAYS_AHEAD }, (_, day) => day);

/** Every id this app ever schedules — what a full "clear before re-scheduling" pass has to cancel. */
export const REMINDER_IDS: readonly number[] = [
  ...LEGACY_REPEATING_IDS,
  ...dayOffsets.map((day) => MORNING_ID_BASE + day),
  ...dayOffsets.map((day) => EVENING_ID_BASE + day),
];

export type ReminderSlot = 'morning' | 'evening';

/** A wall-clock time of day, as the OS wants it (a daily repeat, not a one-off date). */
export interface TimeOfDay {
  hour: number;
  minute: number;
}

/** One reminder on one day, ready to hand to the OS. */
export interface PlannedReminder {
  id: number;
  slot: ReminderSlot;
  title: string;
  text: string;
  /** The moment it fires — a specific day, not a daily repeat (see {@link DAYS_AHEAD}). */
  at: Date;
  /** Evening nudges post quietly (low-importance channel, no sound); the morning one announces itself. */
  silent: boolean;
  /** Where tapping it opens the app — handed to the OS with the alarm, and read back at the tap. */
  opensAt: LandingSpot;
}

/**
 * Everything the plan depends on: the two reminder switches and times exactly as Settings stores them,
 * plus the review state the evening nudge is conditional on.
 */
export interface ReminderSettings {
  morningEnabled: boolean;
  morningTime: string; // "HH:mm", as the <input type="time"> writes it
  eveningEnabled: boolean;
  eveningTime: string;
  /**
   * Whether today's work is done — neither of today's reminders has anything to say if so, and both
   * are dropped. Only today's: the days after it are planned as usual.
   */
  dayComplete: boolean;
  /** Unreviewed photos still waiting in today's deck. Nothing waiting, nothing to nudge about. */
  pileCount: number;
  /**
   * Whether the *library* still has anything to do — anywhere, not just in today's deck.
   *
   * Separate from {@link pileCount} because they empty at different times: the deck empties every
   * time a day is finished, while this only empties when the whole backlog is genuinely done.
   */
  workWaiting: boolean;
}

/** The message each slot should carry, picked from the catalog at scheduling time. */
export interface ReminderMessages {
  morning: RenderedNotification | null;
  evening: RenderedNotification | null;
}

/** "HH:mm" as an hour/minute pair, or null when it isn't a real time (never trust stored input). */
export function parseTimeOfDay(value: string): TimeOfDay | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/**
 * Fallbacks for when the catalog has nothing eligible — every message on cooldown, say.
 *
 * A reminder must never be dropped for want of words. {@link OsReminders.apply} cancels each slot
 * before scheduling, so returning null here does not leave yesterday's alarm in place: it withdraws
 * it. Silence caused by an empty catalog is indistinguishable, to the user, from the feature being
 * broken.
 */
const DEFAULT_MORNING: RenderedNotification = {
  id: 'default-morning',
  icon: '📷',
  title: 'Your photos are waiting',
  text: 'A few minutes now keeps the pile from growing.',
  opensAt: 'sort',
};

const DEFAULT_EVENING: RenderedNotification = {
  id: 'default-evening',
  icon: '🌙',
  title: 'Still time today',
  text: 'A quick sort before bed keeps the streak going.',
  opensAt: 'sort',
};

function planMorning(
  settings: ReminderSettings,
  message: RenderedNotification | null,
  now: Date,
): PlannedReminder[] {
  if (!settings.morningEnabled) return [];
  // Nothing in the library to sort: a nudge saying photos are waiting would simply be untrue.
  // Deliberately not `pileCount`, which is today's deck — that empties every time a day is
  // finished, and cancelling tomorrow's reminder for it would be the opposite of the point.
  if (!settings.workWaiting) return [];
  const time = parseTimeOfDay(settings.morningTime);
  if (!time) return [];
  const { title, text, opensAt } = message ?? DEFAULT_MORNING;
  return upcomingDays(time, now, settings.dayComplete).map(({ day, at }) => ({
    id: MORNING_ID_BASE + day,
    slot: 'morning',
    title,
    text,
    at,
    silent: false,
    opensAt,
  }));
}

/**
 * The evening nudge, which Settings promises fires only "if you haven't reviewed and photos still
 * remain" — so a finished day or an empty pile plans tonight's out of existence rather than sending
 * something untrue. Since the plan is re-applied whenever those change, finishing the day's sorting
 * is what cancels tonight's alarm. The evenings after it stand, as long as the library has work.
 */
function planEvening(
  settings: ReminderSettings,
  message: RenderedNotification | null,
  now: Date,
): PlannedReminder[] {
  if (!settings.eveningEnabled || !settings.workWaiting) return [];
  const time = parseTimeOfDay(settings.eveningTime);
  if (!time) return [];
  const { title, text, opensAt } = message ?? DEFAULT_EVENING;
  const skipToday = settings.dayComplete || settings.pileCount <= 0;
  return upcomingDays(time, now, skipToday).map(({ day, at }) => ({
    id: EVENING_ID_BASE + day,
    slot: 'evening',
    title,
    text,
    at,
    silent: true,
    opensAt,
  }));
}

/**
 * The moments `time` falls on over the next {@link DAYS_AHEAD} days, counting today as day 0 — minus
 * any already past (an alarm dated in the past fires at once), and minus today when it is skipped.
 * Built from calendar fields rather than by adding 24 hours, so a daylight-saving change does not
 * move the reminder by an hour.
 */
function upcomingDays(time: TimeOfDay, now: Date, skipToday: boolean): { day: number; at: Date }[] {
  return dayOffsets
    .filter((day) => !(skipToday && day === 0))
    .map((day) => ({
      day,
      at: new Date(now.getFullYear(), now.getMonth(), now.getDate() + day, time.hour, time.minute),
    }))
    .filter(({ at }) => at.getTime() > now.getTime());
}

/**
 * The complete set of reminders the OS should be holding right now. Pure: the caller cancels
 * everything in {@link REMINDER_IDS} and schedules exactly what comes back, so a reminder that drops
 * out of the plan is a reminder that gets cancelled.
 */
export function planReminders(
  settings: ReminderSettings,
  messages: ReminderMessages,
  now: Date,
): PlannedReminder[] {
  return [
    ...planMorning(settings, messages.morning, now),
    ...planEvening(settings, messages.evening, now),
  ];
}

/** Whether two settings snapshots are the same, so an unchanged one doesn't churn the OS alarms. */
export function sameSettings(a: ReminderSettings, b: ReminderSettings): boolean {
  return (
    a.morningEnabled === b.morningEnabled &&
    a.morningTime === b.morningTime &&
    a.eveningEnabled === b.eveningEnabled &&
    a.eveningTime === b.eveningTime &&
    a.dayComplete === b.dayComplete &&
    a.workWaiting === b.workWaiting &&
    // Whether the pile is empty, not how big it is. The plan only asks `pileCount <= 0`, but
    // comparing the number meant every swipe looked like a change and rewrote the OS alarms — the
    // opposite of what the comment on `settings` claimed, and the reason picking messages at
    // schedule time drained the catalog within a couple of decisions.
    a.pileCount > 0 === b.pileCount > 0
  );
}
