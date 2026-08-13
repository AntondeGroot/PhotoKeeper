import { Injectable, computed, inject, signal } from '@angular/core';
import { dateKey, todayKey } from './review-feed.service';
import { BacklogStatusService } from './backlog-status.service';

const STORAGE_KEY = 'review-streak';
const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Freezes held at once, and the run length that earns another. */
export const MAX_FREEZES = 3;
export const DAYS_PER_FREEZE = 60;

/**
 * A run of consecutive days the daily goal was met, stored as its length plus the day it last
 * reached — rather than the list of days themselves, which would grow forever to answer a question
 * that only ever needs the tail of it.
 *
 * `freezes` are banked misses. One is spent automatically per missed day, so a run survives a day
 * you forgot. They are earned by the run itself reaching a multiple of {@link DAYS_PER_FREEZE},
 * which makes them a reward for the consistency they protect.
 */
export interface StreakState {
  days: number;
  lastDay: string; // YYYY-MM-DD, local
  freezes: number;
}

/** What settling a run on a new day did to it — the caller needs to know a freeze was spent. */
export interface Settlement {
  state: StreakState;
  /** Freezes spent covering missed days; > 0 is what earns the "streak frozen" celebration. */
  freezesUsed: number;
  /** True when the gap was skipped because there was nothing to do, costing nothing. */
  paused: boolean;
}

/** Whole days from one day key to another. */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
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
  if (!state) return grantEarnedFreeze({ days: 1, lastDay: today, freezes: 0 });
  if (state.lastDay === today) return state;

  const freezes = state.freezes;
  if (state.lastDay === previousDay(today)) {
    return grantEarnedFreeze({ days: state.days + 1, lastDay: today, freezes });
  }
  // Starting over keeps the freezes already banked: they were earned, and losing them on the day
  // the run breaks would punish the same miss twice.
  return grantEarnedFreeze({ days: 1, lastDay: today, freezes });
}

/** A run reaching a multiple of {@link DAYS_PER_FREEZE} banks a freeze, up to the cap. */
function grantEarnedFreeze(state: StreakState): StreakState {
  const earned = state.days > 0 && state.days % DAYS_PER_FREEZE === 0;
  if (!earned || state.freezes >= MAX_FREEZES) return state;
  return { ...state, freezes: state.freezes + 1 };
}

/**
 * Brings a run up to `today`, spending freezes on any days missed in between.
 *
 * Called when the app is opened rather than when the goal is met, because a missed day is only
 * observable from the far side of it. `workAvailable` is what separates "you forgot" from "there
 * was nothing to forget": with the whole backlog cleared there is no daily task to do, so the gap
 * is skipped without touching the streak or the freezes — you could be waiting weeks for prints.
 * The run resumes at its old length the day new photos arrive and the goal is met again.
 */
export function settleStreak(
  state: StreakState | null,
  today: string,
  workAvailable: boolean,
): Settlement {
  if (!state)
    return { state: { days: 0, lastDay: today, freezes: 0 }, freezesUsed: 0, paused: false };

  const missed = daysBetween(state.lastDay, today) - 1;
  if (missed <= 0) return { state, freezesUsed: 0, paused: false }; // today or yesterday: still alive

  if (!workAvailable) return { state: { ...state, lastDay: today }, freezesUsed: 0, paused: true };

  if (state.freezes >= missed) {
    return {
      state: { ...state, lastDay: today, freezes: state.freezes - missed },
      freezesUsed: missed,
      paused: false,
    };
  }
  // Not enough banked: the run ends, but the freezes it did have are spent covering what they can.
  return {
    state: { days: 0, lastDay: today, freezes: 0 },
    freezesUsed: state.freezes,
    paused: false,
  };
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
    if (!isStreakState(parsed)) return null;
    // Runs recorded before freezes existed have no count; they start with none rather than NaN.
    return { ...parsed, freezes: parsed.freezes ?? 0 };
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
    candidate.days >= 0 &&
    (candidate.freezes === undefined ||
      (Number.isInteger(candidate.freezes) && candidate.freezes >= 0)) &&
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
  private readonly backlog = inject(BacklogStatusService);
  private readonly state = signal<StreakState | null>(readState());

  /** Consecutive days the goal has been met; 0 once a whole day has gone by without it. */
  readonly days = computed(() => streakOn(this.state(), todayKey()));

  /**
   * Whether today's goal has been met yet.
   *
   * A run stays alive through the day after it last reached, so the count on screen is the same
   * before and after today's session — this is what separates "still standing" from "kept up".
   */
  readonly metToday = computed(() => this.state()?.lastDay === todayKey());

  /** Freezes banked and available to cover a missed day. */
  readonly freezes = computed(() => this.state()?.freezes ?? 0);

  /**
   * How many freezes settling spent on the way in — 0 for an ordinary open. Drives the notice shown
   * over the app, because a covered day is news about days already gone: it belongs at the moment
   * you open the app, not at the end of the session you are about to do.
   *
   * Cleared by {@link acknowledgeFreezeUse} once the notice has been seen. Settling advances the day
   * it settled to, so the same gap can never be reported twice.
   */
  readonly freezesJustUsed = signal(0);

  /** Dismisses the notice. */
  acknowledgeFreezeUse(): void {
    this.freezesJustUsed.set(0);
  }

  constructor() {
    this.hydrate();
  }

  // Sync wrapper keeps the async call out of the constructor body (which sonarjs flags).
  private hydrate(): void {
    void this.settleOnOpen();
  }

  /**
   * Brings the run up to today, which is when a missed day first becomes visible. Needs to know
   * whether there was anything to do, so it waits on the backlog rather than assuming.
   */
  private async settleOnOpen(): Promise<void> {
    const current = this.state();
    if (!current) return; // no run yet — nothing to settle

    // If the backlog cannot be read, assume there was work: settling then costs a freeze at worst,
    // where the optimistic guess would silently stop streaks ever breaking. Best-effort either way —
    // this runs fire-and-forget from the constructor, so a rejection would go nowhere.
    const workWaiting = await this.backlog.hasWorkWaiting().catch(() => true);
    const settled = settleStreak(current, todayKey(), workWaiting);
    if (settled.state === current) return;

    this.persist(settled.state);
    if (settled.freezesUsed > 0) this.freezesJustUsed.set(settled.freezesUsed);
  }

  /**
   * Records that today's goal was met. Counting is idempotent per day, however often it fires.
   *
   * Returns whether that just unlocked a freeze, so the caller can announce it — a reward nobody
   * is told about is not a reward, and the run reaching sixty days is the only moment it happens.
   */
  recordGoalMet(): boolean {
    const before = this.freezes();
    this.persist(extendStreak(this.state(), todayKey()));
    return this.freezes() > before;
  }

  private persist(next: StreakState): void {
    this.state.set(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // A full or blocked quota costs the streak, never the review flow.
    }
  }
}
