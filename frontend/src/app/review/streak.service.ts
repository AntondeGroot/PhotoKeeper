import { Injectable, computed, signal } from '@angular/core';
import { dateKey, todayKey } from './review-feed.service';

const STORAGE_KEY = 'review-streak';
const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A run of consecutive days the daily goal was met, stored as its length plus the day it last
 * reached — rather than the list of days themselves, which would grow forever to answer a question
 * that only ever needs the tail of it.
 */
export interface StreakState {
  days: number;
  lastDay: string; // YYYY-MM-DD, local
}

/** The local day before `key`. Built at midday so a DST jump at midnight cannot shift the date. */
export function previousDay(key: string): string {
  const [year, month, day] = key.split('-').map(Number);
  return dateKey(new Date(year, month - 1, day - 1, 12));
}

/**
 * The run after meeting the goal on `today`. Meeting it twice in a day is not two days, and a gap of
 * a full day starts again from one.
 */
export function extendStreak(state: StreakState | null, today: string): StreakState {
  if (!state) return { days: 1, lastDay: today };
  if (state.lastDay === today) return state;
  if (state.lastDay === previousDay(today)) return { days: state.days + 1, lastDay: today };
  return { days: 1, lastDay: today };
}

/**
 * What the run is worth on `today`.
 *
 * <p>A run survives the day after it last reached, so the chip doesn't drop to zero every midnight
 * and only reappear once you've reviewed — from the reader's point of view a streak is broken by a
 * missed day, not by a day not yet finished.
 */
export function streakOn(state: StreakState | null, today: string): number {
  if (!state) return 0;
  const alive = state.lastDay === today || state.lastDay === previousDay(today);
  return alive ? state.days : 0;
}

function readState(): StreakState | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isStreakState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isStreakState(value: unknown): value is StreakState {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<StreakState>;
  return (
    typeof candidate.days === 'number' &&
    Number.isInteger(candidate.days) &&
    candidate.days > 0 &&
    typeof candidate.lastDay === 'string' &&
    DAY_KEY_PATTERN.test(candidate.lastDay)
  );
}

/**
 * How many days running the daily goal has been met.
 *
 * <p>Counts goal-met days rather than days-with-any-review, because that is the day the app already
 * treats as finished: it's what {@link ReviewDecisionsService} celebrates, and what the notification
 * catalog's milestones are written against.
 */
@Injectable({ providedIn: 'root' })
export class StreakService {
  private readonly state = signal<StreakState | null>(readState());

  /** Consecutive days the goal has been met; 0 once a whole day has gone by without it. */
  readonly days = computed(() => streakOn(this.state(), todayKey()));

  /** Records that today's goal was met. Counting is idempotent per day, however often it fires. */
  recordGoalMet(): void {
    const next = extendStreak(this.state(), todayKey());
    this.state.set(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // A full or blocked quota costs the streak, never the review flow.
    }
  }
}
