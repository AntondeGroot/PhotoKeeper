import { CapacitorOsReminders, LocalNotificationsPlugin } from './capacitor-os-reminders';
import { PlannedReminder } from './reminder-plan';
import { LandingSpot } from './landing';

type Scheduled = { id: number; extra: { opensAt: LandingSpot } };
type TapListener = (event: { notification?: { extra?: { opensAt?: unknown } } }) => void;

function reminder(overrides: Partial<PlannedReminder> = {}): PlannedReminder {
  return {
    id: 1,
    title: 'Your edit queue is filling up',
    text: '7 waiting — knock out a few today?',
    at: { hour: 9, minute: 0 },
    silent: false,
    opensAt: 'edit',
    ...overrides,
  };
}

describe('CapacitorOsReminders', () => {
  let scheduled: Scheduled[];
  let listeners: TapListener[];
  let os: CapacitorOsReminders;

  beforeEach(() => {
    scheduled = [];
    listeners = [];
    const plugin = {
      checkPermissions: () => Promise.resolve({ display: 'granted' as const }),
      requestPermissions: () => Promise.resolve({ display: 'granted' as const }),
      createChannel: () => Promise.resolve(),
      cancel: () => Promise.resolve(),
      schedule: (options: { notifications: Scheduled[] }) => {
        scheduled.push(...options.notifications);
        return Promise.resolve(undefined);
      },
      addListener: (_event: 'localNotificationActionPerformed', listener: TapListener) => {
        listeners.push(listener);
        return Promise.resolve({ remove: () => Promise.resolve() });
      },
    } as unknown as LocalNotificationsPlugin;
    os = new CapacitorOsReminders(plugin);
  });

  it('hands the OS the step each reminder is about, so the tap can act on it', async () => {
    // The alarm may be tapped hours later, from cold. Nothing else survives that trip.
    await os.apply([reminder({ opensAt: 'edit' })]);

    expect(scheduled[0].extra).toEqual({ opensAt: 'edit' });
  });

  it('reports the step when the app is opened from a reminder', () => {
    const opened: LandingSpot[] = [];
    os.onOpened((spot) => opened.push(spot));

    listeners[0]({ notification: { extra: { opensAt: 'edit' } } });

    expect(opened).toEqual(['edit']);
  });

  it('ignores a step this build does not have', () => {
    // An alarm scheduled by an older build can name anything; opening where the app always did beats
    // acting on a value it cannot honour.
    const opened: LandingSpot[] = [];
    os.onOpened((spot) => opened.push(spot));

    listeners[0]({ notification: { extra: { opensAt: 'keepsakes' } } });
    listeners[0]({});

    expect(opened).toEqual([]);
  });
});
