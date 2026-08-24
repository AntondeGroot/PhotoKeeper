import type { OsReminders } from './os-reminders';
import { PlannedReminder, REMINDER_IDS } from './reminder-plan';
import { LandingSpot, isLandingSpot } from './landing';

/** Android importance levels. 4 = pops up with a sound; 2 = sits quietly in the shade. */
const IMPORTANCE_HIGH = 4;
const IMPORTANCE_LOW = 2;

/**
 * Two channels, because "silent" is a property of the *channel* on Android, not of the notification —
 * one notification can't be quiet on a noisy channel. Ids are versioned: a channel's importance is
 * fixed once created, so changing it later means shipping a new id.
 */
const LOUD_CHANNEL = 'photokeeper-reminders-v1';
const QUIET_CHANNEL = 'photokeeper-reminders-quiet-v1';

type PermissionState = 'prompt' | 'prompt-with-rationale' | 'granted' | 'denied';

interface ChannelSpec {
  id: string;
  name: string;
  description: string;
  importance: number;
  vibration: boolean;
}

interface NotificationSpec {
  id: number;
  title: string;
  body: string;
  channelId: string;
  /** `on` without a day is Capacitor's daily cron: it re-arms itself after each fire. */
  schedule: { on: { hour: number; minute: number }; allowWhileIdle: boolean };
  /** Ours to fill: Android hands it back untouched when the notification is tapped. */
  extra: { opensAt: LandingSpot };
}

/** The tap event, as the plugin delivers it: the notification exactly as it was scheduled. */
interface ActionPerformed {
  notification?: { extra?: { opensAt?: unknown } };
}

interface ListenerHandle {
  remove(): Promise<void>;
}

/** The slice of @capacitor/local-notifications this app uses, as the native bridge exposes it. */
export interface LocalNotificationsPlugin {
  checkPermissions(): Promise<{ display: PermissionState }>;
  requestPermissions(): Promise<{ display: PermissionState }>;
  createChannel(channel: ChannelSpec): Promise<void>;
  cancel(options: { notifications: { id: number }[] }): Promise<void>;
  schedule(options: { notifications: NotificationSpec[] }): Promise<unknown>;
  addListener(
    eventName: 'localNotificationActionPerformed',
    listener: (event: ActionPerformed) => void,
  ): Promise<ListenerHandle>;
}

interface CapacitorBridge {
  Plugins?: { LocalNotifications?: LocalNotificationsPlugin };
}

/**
 * The LocalNotifications plugin if we're running inside the native shell, else null. Read off the
 * bridge that Capacitor injects into the webview rather than imported from `@capacitor/core`: the
 * same bundle is served to plain browsers, where that import would be dead weight that also has to
 * be kept from running.
 */
export function localNotificationsPlugin(): LocalNotificationsPlugin | null {
  const bridge = (globalThis as { Capacitor?: CapacitorBridge }).Capacitor;
  return bridge?.Plugins?.LocalNotifications ?? null;
}

function channelOf(reminder: PlannedReminder): string {
  return reminder.silent ? QUIET_CHANNEL : LOUD_CHANNEL;
}

function toNotification(reminder: PlannedReminder): NotificationSpec {
  return {
    id: reminder.id,
    title: reminder.title,
    body: reminder.text,
    channelId: channelOf(reminder),
    // allowWhileIdle so Doze doesn't hold a 09:00 reminder until the phone next wakes. The plugin
    // downgrades to an inexact alarm by itself when exact alarms aren't permitted.
    schedule: { on: { hour: reminder.at.hour, minute: reminder.at.minute }, allowWhileIdle: true },
    extra: { opensAt: reminder.opensAt },
  };
}

/** Native reminders via @capacitor/local-notifications — the Android build's {@link OsReminders}. */
export class CapacitorOsReminders implements OsReminders {
  constructor(private readonly plugin: LocalNotificationsPlugin) {}

  /** Android 13+ needs POST_NOTIFICATIONS at runtime; older versions report granted straight away. */
  async ensurePermission(): Promise<boolean> {
    const current = await this.plugin.checkPermissions();
    if (current.display === 'granted') return true;
    if (current.display === 'denied') return false;
    const asked = await this.plugin.requestPermissions();
    return asked.display === 'granted';
  }

  async apply(reminders: PlannedReminder[]): Promise<void> {
    await this.ensureChannels();
    // Cancel every slot first, so one that dropped out of the plan is actually withdrawn — scheduling
    // alone would only overwrite the slots that are still in it.
    await this.plugin.cancel({ notifications: REMINDER_IDS.map((id) => ({ id })) });
    if (reminders.length === 0) return;
    await this.plugin.schedule({ notifications: reminders.map(toNotification) });
  }

  /**
   * Where the tap wants to go, once the user opens the app from one of these reminders.
   *
   * Registered on startup rather than lazily: Android retains the event until something listens, so
   * a cold start — the app was not running when the notification fired, which is the normal case —
   * still delivers it, but only to a listener that is already there.
   */
  onOpened(listener: (spot: LandingSpot) => void): void {
    void this.plugin.addListener('localNotificationActionPerformed', (event) => {
      const spot = event.notification?.extra?.opensAt;
      // A reminder scheduled by an older build may name a step this one no longer has; ignoring it
      // opens the app where it always did rather than acting on a value we cannot honour.
      if (isLandingSpot(spot)) listener(spot);
    });
  }

  private async ensureChannels(): Promise<void> {
    await this.plugin.createChannel({
      id: LOUD_CHANNEL,
      name: 'Daily reminder',
      description: 'The morning nudge to start your review',
      importance: IMPORTANCE_HIGH,
      vibration: true,
    });
    await this.plugin.createChannel({
      id: QUIET_CHANNEL,
      name: 'Quiet evening reminder',
      description: 'A silent nudge when the day still has photos waiting',
      importance: IMPORTANCE_LOW,
      vibration: false,
    });
  }
}
