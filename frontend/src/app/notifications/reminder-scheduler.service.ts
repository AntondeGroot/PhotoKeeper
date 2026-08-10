import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { PreferencesService } from '../preferences.service';
import { ReviewStatsService } from '../review/review-stats.service';
import { ReviewDecisionsService } from '../review/review-decisions.service';
import { AlbumPrintStore } from '../storage/review/album-print-store';
import { NotificationService } from './notification.service';
import { OS_REMINDERS } from './os-reminders';
import { ReviewStats } from './notification-message';
import { ReminderMessages, ReminderSettings, planReminders, sameSettings } from './reminder-plan';

/**
 * Keeps the OS holding the right daily reminders. Settings owns the two switches and times; this is
 * what makes them mean something — it watches them (plus the review state the evening nudge is
 * conditional on) and re-applies the whole plan whenever any of it changes.
 *
 * <p>The message text is picked when the reminder is *scheduled*, not when it fires: an alarm handed
 * to the OS carries fixed text, and the alternative — waking the app in the background to pick — is
 * not something a webview build can do reliably. So the wording reflects the state at the last app
 * open, and is refreshed on the next one.
 *
 * <p>On the web the injected {@link OS_REMINDERS} is a no-op, so all of this is inert there.
 */
@Injectable({ providedIn: 'root' })
export class ReminderSchedulerService {
  private readonly prefs = inject(PreferencesService);
  private readonly stats = inject(ReviewStatsService);
  private readonly decisions = inject(ReviewDecisionsService);
  private readonly notifications = inject(NotificationService);
  private readonly printStore = inject(AlbumPrintStore);
  private readonly os = inject(OS_REMINDERS);

  /** Clock seam, so a test can plan against a fixed day rather than whenever it happens to run. */
  now: () => Date = () => new Date();

  /** Albums ordered and awaiting placement. Read once — it only moves when you act on the Prints tab. */
  private readonly printsAwaiting = signal(0);

  /** The permission ask, cached as the in-flight promise so a burst of changes can't double-prompt. */
  private permissionCheck: Promise<boolean> | null = null;

  /**
   * Everything the plan depends on, in one snapshot. The custom equality is what stops every single
   * swipe re-writing the OS alarms: the pile count changes constantly, but the *plan* only changes
   * when it crosses zero or the day completes.
   */
  readonly settings = computed<ReminderSettings>(
    () => ({
      morningEnabled: this.prefs.morningReminder(),
      morningTime: this.prefs.reminderTime(),
      eveningEnabled: this.prefs.silentEvening(),
      eveningTime: this.prefs.silentTime(),
      dayComplete: this.stats.doneToday() >= this.prefs.dailyGoal(),
      pileCount: this.stats.backlogCount(),
    }),
    { equal: sameSettings },
  );

  constructor() {
    this.hydrate();
    effect(() => void this.reschedule(this.settings()));
  }

  // Sync wrapper keeps the async call out of the constructor body (which sonarjs flags).
  private hydrate(): void {
    void this.countAwaitingPrints();
  }

  private async reschedule(settings: ReminderSettings): Promise<void> {
    if (!(await this.permission())) return;
    const messages = untracked(() => this.pickMessages(settings));
    await this.os.apply(planReminders(settings, messages));
  }

  private permission(): Promise<boolean> {
    this.permissionCheck ??= this.os.ensurePermission();
    return this.permissionCheck;
  }

  /** One message per enabled slot. Picked separately so morning and evening don't say the same thing. */
  private pickMessages(settings: ReminderSettings): ReminderMessages {
    const stats = this.reviewStats(settings);
    return {
      morning: settings.morningEnabled ? this.notifications.pickAndRecord(stats) : null,
      evening: settings.eveningEnabled ? this.notifications.pickAndRecord(stats) : null,
    };
  }

  private reviewStats(settings: ReminderSettings): ReviewStats {
    return {
      date: this.now(),
      pileCount: settings.pileCount,
      streak: this.decisions.streakDays(),
      editQueue: this.stats.toEditQueue().length,
      printsArrived: this.printsAwaiting(),
    };
  }

  private async countAwaitingPrints(): Promise<void> {
    try {
      const states = await this.printStore.getAll();
      this.printsAwaiting.set([...states.values()].filter((state) => state === 'ordered').length);
    } catch {
      // No print history readable — the print-day message simply never qualifies. Never break boot.
    }
  }
}
