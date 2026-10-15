import { Injectable, computed, signal } from '@angular/core';
import { dateKey, dayLabel, msUntilNextDay } from './day';

/**
 * Which day the app currently believes it is, as a signal.
 *
 * Everything about a review session is scoped to a day — the deck, the goals, the streak — and every
 * one of them used to ask `todayKey()` at the moment it happened. That is correct for anything
 * triggered by a tap, and quietly wrong for anything already on screen: an app left open overnight
 * went on showing yesterday's finished deck, yesterday's "all caught up", and a streak chip that
 * said the day's work was done, because nothing ever asked the question again.
 *
 * So the day is held rather than fetched, and the holder is responsible for noticing it changed.
 * Two mechanisms, because neither is sufficient alone: a timer to the next local midnight, which is
 * exact while the app is running, and a re-check whenever the page becomes visible or focused, which
 * catches the far commoner case of a laptop that was asleep at midnight and a timer that never fired
 * on time (or fired hours late).
 */
@Injectable({ providedIn: 'root' })
export class DayService {
  /** The moment the current day was last established — the source of both derived values below. */
  private readonly now = signal(new Date());
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** Local day key (YYYY-MM-DD). Reading this in a computed makes it react to the day turning over. */
  readonly today = computed(() => dateKey(this.now()));

  /** The header's date line, e.g. "Tuesday 9 June". */
  readonly label = computed(() => dayLabel(this.now()));

  constructor() {
    this.scheduleRollover();
    // Backgrounded tabs are throttled and suspended machines fire nothing, so the timer is a
    // best-case mechanism. Coming back to the app is the moment that actually matters.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.refresh();
    });
    window.addEventListener('focus', () => this.refresh());
  }

  /**
   * Re-reads the clock, and updates the day only when it has actually changed.
   *
   * Guarded so that the ordinary case — a tab focused twenty times an hour — writes nothing and
   * wakes no computed. Only a real rollover propagates, and every consumer downstream is written to
   * treat that as "start the day again".
   */
  refresh(): void {
    const now = new Date();
    if (dateKey(now) === this.today()) return;
    this.now.set(now);
    this.scheduleRollover();
  }

  /** Aims a timer at the next local midnight, replacing any already pending. */
  private scheduleRollover(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.refresh(), msUntilNextDay(new Date()));
  }

  /** For tests and teardown: stops the pending rollover timer. */
  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
