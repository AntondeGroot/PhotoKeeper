import { Injectable, inject, signal } from '@angular/core';
import { OS_REMINDERS } from './os-reminders';
import { LandingSpot } from './landing';

/**
 * Holds where the app was asked to open, when it was opened by tapping a reminder.
 *
 * A signal rather than a callback into the app component: the tap can arrive before the app has
 * finished starting (a cold start is the normal case — the phone was asleep), so what the OS says
 * has to be parked somewhere until there is a screen to put it on.
 */
@Injectable({ providedIn: 'root' })
export class NotificationLaunchService {
  private readonly os = inject(OS_REMINDERS);

  /**
   * The step the tapped reminder was about, until the app has honoured it and cleared it back to
   * null — which is also what lets a second tap on the same kind of reminder land again.
   */
  readonly requested = signal<LandingSpot | null>(null);

  constructor() {
    this.os.onOpened((spot) => this.requested.set(spot));
  }
}
