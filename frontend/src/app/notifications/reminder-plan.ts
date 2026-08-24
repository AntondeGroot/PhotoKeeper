import { RenderedNotification } from './notification-message';
import { LandingSpot } from './landing';

/**
 * Stable OS notification ids. Fixed (not generated) on purpose: re-scheduling reuses the id, so the
 * OS *replaces* yesterday's pending alarm instead of stacking a second one behind it.
 */
export const MORNING_REMINDER_ID = 1;
export const EVENING_REMINDER_ID = 2;

/** Every id this app ever schedules — what a full "clear before re-scheduling" pass has to cancel. */
export const REMINDER_IDS: readonly number[] = [MORNING_REMINDER_ID, EVENING_REMINDER_ID];

/** A wall-clock time of day, as the OS wants it (a daily repeat, not a one-off date). */
export interface TimeOfDay {
  hour: number;
  minute: number;
}

/** One daily reminder, ready to hand to the OS. */
export interface PlannedReminder {
  id: number;
  title: string;
  text: string;
  at: TimeOfDay;
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
  /** Whether today's sorting goal has already been met — the evening nudge has nothing to say if so. */
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

/** The morning nudge: unconditional while its toggle is on — it's the "start your review" prompt. */
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
): PlannedReminder | null {
  if (!settings.morningEnabled) return null;
  // Nothing in the library to sort: a nudge saying photos are waiting would simply be untrue.
  // Deliberately not `pileCount`, which is today's deck — that empties every time a day is
  // finished, and cancelling tomorrow's reminder for it would be the opposite of the point.
  if (!settings.workWaiting) return null;
  const at = parseTimeOfDay(settings.morningTime);
  if (!at) return null;
  const { title, text, opensAt } = message ?? DEFAULT_MORNING;
  return { id: MORNING_REMINDER_ID, title, text, at, silent: false, opensAt };
}

/**
 * The evening nudge, which Settings promises fires only "if you haven't reviewed and photos still
 * remain" — so a finished day or an empty pile plans it out of existence rather than sending
 * something untrue. Since the plan is re-applied whenever those change, finishing the day's sorting
 * is what cancels tonight's alarm.
 */
function planEvening(
  settings: ReminderSettings,
  message: RenderedNotification | null,
): PlannedReminder | null {
  if (!settings.eveningEnabled) return null;
  if (settings.dayComplete || settings.pileCount <= 0) return null;
  const at = parseTimeOfDay(settings.eveningTime);
  if (!at) return null;
  const { title, text, opensAt } = message ?? DEFAULT_EVENING;
  return { id: EVENING_REMINDER_ID, title, text, at, silent: true, opensAt };
}

/**
 * The complete set of reminders the OS should be holding right now. Pure: the caller cancels
 * everything in {@link REMINDER_IDS} and schedules exactly what comes back, so a slot that drops out
 * of the plan is a slot that gets cancelled.
 */
export function planReminders(
  settings: ReminderSettings,
  messages: ReminderMessages,
): PlannedReminder[] {
  const planned = [
    planMorning(settings, messages.morning),
    planEvening(settings, messages.evening),
  ];
  return planned.filter((reminder): reminder is PlannedReminder => reminder !== null);
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
