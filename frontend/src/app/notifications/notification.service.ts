import { Injectable, inject } from '@angular/core';
import { CATALOG } from './catalog/catalog';
import { RenderedNotification, ReviewStats } from './notification-message';
import { pickNotification } from './picker';
import { NOTIFICATION_SENDER } from './notification-sender';

/** localStorage key for the per-message "last shown" timestamps that drive cooldowns. */
const HISTORY_KEY = 'headsUpHistory';

/**
 * Orchestrates the OS-notification heads-ups: builds the cooldown history, asks the picker for the one
 * message that best fits the current {@link ReviewStats}, records that it fired, and hands it to the
 * active {@link NOTIFICATION_SENDER}. Pure selection lives in picker.ts; this owns the side effects
 * (persistence + send). On the web PoC the sender is a no-op logger; native swaps in Capacitor.
 *
 * Two ways in. {@link maybeNotify} picks and delivers now. {@link pickAndRecord} only picks — that's
 * what the reminder scheduler uses, because a notification handed to the OS in advance has to carry
 * its text at scheduling time, not at fire time.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly sender = inject(NOTIFICATION_SENDER);

  /** Random source for the picker's tiebreak — overridable in tests for determinism. */
  rng: () => number = Math.random;

  /** Picks, records, and sends the best-fitting notification for `stats`. Returns it, or null. */
  async maybeNotify(stats: ReviewStats): Promise<RenderedNotification | null> {
    const picked = this.pickAndRecord(stats);
    if (!picked) return null;

    await this.sender.send(picked);
    return picked;
  }

  /**
   * Picks the best-fitting message for `stats` and records it against the cooldowns, without sending.
   * Recording at pick time is deliberate: the caller is about to hand it to the OS, so it *will* be
   * shown, and two picks in a row (morning + evening) then get different messages.
   */
  pickAndRecord(stats: ReviewStats): RenderedNotification | null {
    const picked = this.pick(stats);
    if (picked) this.recordShown(picked.id, stats.date);
    return picked;
  }

  /**
   * Picks without consuming. For a caller that is only choosing the *text* of something scheduled
   * for later — the OS reminders — recording here would be a lie: the message has not been shown,
   * it has been written onto an alarm that may never fire.
   *
   * Recording at pick time drained the catalog. The reminder plan is recomputed on every swipe and
   * asks for two messages each time, so the three unconditional messages were spent within a couple
   * of decisions; after that picking returned null, and a reminder with no text is not scheduled at
   * all — {@link OsReminders.apply} cancels the slots first, so rescheduling actively withdrew the
   * reminders instead of setting them.
   */
  pick(stats: ReviewStats): RenderedNotification | null {
    return pickNotification(CATALOG, stats, this.loadHistory(), this.rng);
  }

  /** Marks a message as shown, starting its cooldown. Called when it is actually delivered. */
  recordShown(id: string, when: Date): void {
    const history = this.loadHistory();
    history[id] = when.getTime();
    this.saveHistory(history);
  }

  private loadHistory(): Record<string, number> {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : {};
      return isNumberRecord(parsed) ? parsed : {};
    } catch {
      return {}; // corrupt/unavailable storage → treat as no history (worst case, a message repeats)
    }
  }

  private saveHistory(history: Record<string, number>): void {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch {
      // Non-persistent storage — the cooldown just won't survive a reload; never break the flow.
    }
  }
}

function isNumberRecord(value: unknown): value is Record<string, number> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.values(value).every((v) => typeof v === 'number')
  );
}
