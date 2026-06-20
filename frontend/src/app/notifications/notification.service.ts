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
 * Not yet wired to a schedule: a native build calls {@link maybeNotify} from the morning/evening
 * reminder fire (the OS notification is the "you're away" nudge — never while the app is foreground).
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly sender = inject(NOTIFICATION_SENDER);

  /** Random source for the picker's tiebreak — overridable in tests for determinism. */
  rng: () => number = Math.random;

  /** Picks, records, and sends the best-fitting notification for `stats`. Returns it, or null. */
  async maybeNotify(stats: ReviewStats): Promise<RenderedNotification | null> {
    const history = this.loadHistory();
    const picked = pickNotification(CATALOG, stats, history, this.rng);
    if (!picked) return null;

    history[picked.id] = stats.date.getTime();
    this.saveHistory(history);
    await this.sender.send(picked);
    return picked;
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
