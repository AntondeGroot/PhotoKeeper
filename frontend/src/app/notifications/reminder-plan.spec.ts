import {
  PlannedReminder,
  ReminderMessages,
  ReminderSettings,
  planReminders,
  sameSettings,
} from './reminder-plan';

/** Both slots on, both times valid, a day with work left — the shape every test varies one field of. */
const UNFINISHED_DAY: ReminderSettings = {
  morningEnabled: true,
  morningTime: '09:00',
  eveningEnabled: true,
  eveningTime: '21:00',
  dayComplete: false,
  pileCount: 12,
  workWaiting: true,
};

/** Early on a weekday, so both of today's reminders are still ahead. */
const NOW = new Date(2026, 10, 13, 7, 0);

/** The slots planned for the same calendar day as {@link NOW}. */
function today(plan: PlannedReminder[]): string[] {
  return plan.filter((r) => r.at.toDateString() === NOW.toDateString()).map((r) => r.slot);
}

const MESSAGES: ReminderMessages = {
  morning: { id: 'm', icon: '📷', title: 'Morning', text: 'Sort a few.', opensAt: 'sort' },
  evening: { id: 'e', icon: '🌙', title: 'Evening', text: 'Still waiting.', opensAt: 'sort' },
};

describe('planReminders', () => {
  it("drops the evening nudge once the day's goal is met", () => {
    const plan = planReminders({ ...UNFINISHED_DAY, dayComplete: true }, MESSAGES, NOW);

    // Absent, not merely re-worded: the caller cancels every slot and schedules what comes back, so
    // leaving it out of the plan is what withdraws an alarm armed earlier in the day.
    expect(today(plan)).not.toContain('evening');
  });
});

describe('a finished day', () => {
  it("drops today's morning and evening reminders, and keeps tomorrow's", () => {
    // Finished at 07:00, before either of today's reminders: neither has anything left to say. But
    // tomorrow is a new day's deck, and has to be nudged as usual without the app being opened.
    const plan = planReminders({ ...UNFINISHED_DAY, dayComplete: true }, MESSAGES, NOW);
    const tomorrow = new Date(2026, 10, 14).toDateString();

    expect(today(plan)).toEqual([]);
    expect(plan.filter((r) => r.at.toDateString() === tomorrow).map((r) => r.slot)).toEqual([
      'morning',
      'evening',
    ]);
  });
});

describe('an exhausted catalog', () => {
  const settings = {
    morningEnabled: true,
    morningTime: '09:00',
    eveningEnabled: true,
    eveningTime: '21:00',
    dayComplete: false,
    pileCount: 12,
    workWaiting: true,
  };

  it('still schedules both reminders when no message is available', () => {
    // Every message on cooldown. apply() cancels each slot before scheduling, so dropping the
    // reminder here would withdraw yesterday's alarm and leave the user with silence.
    const planned = planReminders(settings, { morning: null, evening: null }, NOW);

    expect(today(planned)).toEqual(['morning', 'evening']);
    expect(planned.every((r) => r.title.length > 0 && r.text.length > 0)).toBe(true);
  });
});

describe('a finished library', () => {
  const settings: ReminderSettings = {
    morningEnabled: true,
    morningTime: '09:00',
    eveningEnabled: true,
    eveningTime: '21:00',
    dayComplete: false,
    pileCount: 0,
    workWaiting: false,
  };

  it('schedules nothing when there is nothing left to do', () => {
    // "Your photos are waiting" to someone whose library is finished is simply a lie, and the one
    // reminder that had no pile condition at all was the morning one.
    expect(planReminders(settings, { morning: null, evening: null }, NOW)).toEqual([]);
  });
});

describe('sameSettings', () => {
  const base = {
    morningEnabled: true,
    morningTime: '09:00',
    eveningEnabled: true,
    eveningTime: '21:00',
    dayComplete: false,
    pileCount: 12,
    workWaiting: true,
  };

  it('ignores the size of the pile but not it emptying', () => {
    // One swipe must not count as a change: the plan only asks whether the pile is empty, and
    // rewriting the OS alarms on every decision is what churned through the message catalog.
    expect(sameSettings(base, { ...base, pileCount: 11 })).toBe(true);
    expect(sameSettings(base, { ...base, pileCount: 0 })).toBe(false);
  });
});
