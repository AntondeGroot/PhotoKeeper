import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { PreferencesService } from '../preferences.service';
import { ReviewStatsService } from '../review/review-stats.service';
import { ReviewDecisionsService } from '../review/review-decisions.service';
import { AlbumPrintStore } from '../storage/review/album-print-store';
import { BacklogStatusService } from '../review/backlog-status.service';
import { ReviewBufferService } from '../review/review-buffer.service';
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
  private readonly backlog = inject(BacklogStatusService);
  private readonly buffer = inject(ReviewBufferService);
  private readonly os = inject(OS_REMINDERS);

  /** Clock seam, so a test can plan against a fixed day rather than whenever it happens to run. */
  now: () => Date = () => new Date();

  /** Albums ordered and awaiting placement. Read once — it only moves when you act on the Prints tab. */
  private readonly printsAwaiting = signal(0);

  /**
   * Whether the library still has anything to do. Starts true: until the scan has been read, a
   * reminder that fires needlessly is a far smaller fault than one that never fires at all.
   */
  private readonly workWaiting = signal(true);

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
      workWaiting: this.workWaiting(),
    }),
    { equal: sameSettings },
  );

  constructor() {
    this.hydrate();
    effect(() => void this.reschedule(this.settings()));

    // Whatever is scheduled when the app goes away is what fires tomorrow, so re-check the library
    // on the way out. Finishing the last photo and closing mid-session would otherwise leave a
    // "your photos are waiting" alarm set for a library with nothing in it.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) void this.refreshWorkWaiting();
    });
  }

  // Sync wrapper keeps the async call out of the constructor body (which sonarjs flags).
  private hydrate(): void {
    void this.countAwaitingPrints();
    void this.refreshWorkWaiting();
  }

  /**
   * Whether anything is left to do, answered as cheaply as the situation allows.
   *
   * Anything sitting in the review buffer is, by definition, an unseen photo — so a non-empty
   * buffer settles the question outright, which is the common case and costs nothing. Only once it
   * has run dry is the full scan worth doing, and only then does it tell us something new: the
   * buffer knows about photos to sort, but not about edits outstanding or keepers left untagged.
   */
  private async refreshWorkWaiting(): Promise<void> {
    if (this.buffer.available() > 0) {
      this.workWaiting.set(true);
      return;
    }
    this.workWaiting.set(await this.backlog.hasWorkWaiting().catch(() => true));
  }

  private async reschedule(settings: ReminderSettings): Promise<void> {
    if (!(await this.permission())) return;
    const messages = untracked(() => this.pickMessages(settings));
    await this.os.apply(planReminders(settings, messages));

    // Re-read the library after acting on the plan. Deciding the last photo empties the deck, which
    // is what brought us here — and may have emptied the library with it. Setting the signal to an
    // unchanged value is inert, so this settles after one extra pass rather than looping.
    await this.refreshWorkWaiting();
  }

  private permission(): Promise<boolean> {
    this.permissionCheck ??= this.os.ensurePermission();
    return this.permissionCheck;
  }

  /** One message per enabled slot. Picked separately so morning and evening don't say the same thing. */
  private pickMessages(settings: ReminderSettings): ReminderMessages {
    const stats = this.reviewStats(settings);
    return {
      // pick, not pickAndRecord: this is choosing text for an alarm, not showing anything.
      morning: settings.morningEnabled ? this.notifications.pick(stats) : null,
      evening: settings.eveningEnabled ? this.notifications.pick(stats) : null,
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
