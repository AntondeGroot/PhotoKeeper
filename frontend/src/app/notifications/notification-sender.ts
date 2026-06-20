import { InjectionToken } from '@angular/core';
import { RenderedNotification } from './notification-message';

/**
 * Delivers a resolved notification to the user. The picker engine is platform-agnostic; this is the
 * one seam that isn't. The web PoC binds the no-op {@link WebNotificationSender} (there's no reliable
 * OS notification on the web), and a native build overrides the token with a Capacitor
 * LocalNotifications adapter — no engine code changes.
 */
export interface NotificationSender {
  send(notification: RenderedNotification): Promise<void>;
}

/** Web/PoC sender: logs what *would* fire, so the catalog/picker can be exercised without a native OS. */
export class WebNotificationSender implements NotificationSender {
  send(notification: RenderedNotification): Promise<void> {
    // eslint-disable-next-line no-console
    console.debug(`[heads-up] ${notification.title} — ${notification.text}`);
    return Promise.resolve();
  }
}

/** DI token for the active sender. Defaults to the web stub; a native build provides its own. */
export const NOTIFICATION_SENDER = new InjectionToken<NotificationSender>('NOTIFICATION_SENDER', {
  providedIn: 'root',
  factory: () => new WebNotificationSender(),
});
