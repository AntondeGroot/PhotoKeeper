import { InjectionToken } from '@angular/core';
import { PlannedReminder } from './reminder-plan';
import { CapacitorOsReminders, localNotificationsPlugin } from './capacitor-os-reminders';

/**
 * The one platform seam for *scheduled* reminders. Distinct from {@link NotificationSender}, which
 * delivers a notification now: these are handed to the OS ahead of time and fire with the app closed,
 * which is the only way a "09:00 reminder" can actually mean 09:00.
 */
export interface OsReminders {
  /** Asks for whatever permission delivery needs. False = the OS won't show anything; don't bother. */
  ensurePermission(): Promise<boolean>;
  /** Replaces every reminder this app has scheduled with exactly `reminders` (empty = cancel all). */
  apply(reminders: PlannedReminder[]): Promise<void>;
}

/**
 * Web stub. A browser tab cannot be woken at a fixed time once it's closed — that needs a push server,
 * which this PoC deliberately doesn't have — so rather than fake it with a foreground timer that only
 * works while you're already looking at the app, the web build schedules nothing at all.
 */
export class WebOsReminders implements OsReminders {
  ensurePermission(): Promise<boolean> {
    return Promise.resolve(false);
  }

  apply(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * DI token for the active implementation, chosen at runtime rather than at build time: the Android
 * shell loads the *deployed web bundle* (see capacitor.config.ts `server.url`), so one bundle serves
 * both and only the presence of the injected Capacitor bridge tells them apart.
 */
export const OS_REMINDERS = new InjectionToken<OsReminders>('OS_REMINDERS', {
  providedIn: 'root',
  factory: () => {
    const plugin = localNotificationsPlugin();
    return plugin ? new CapacitorOsReminders(plugin) : new WebOsReminders();
  },
});
