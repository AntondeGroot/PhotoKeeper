import {
  EVENING_REMINDER_ID,
  MORNING_REMINDER_ID,
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

const MESSAGES: ReminderMessages = {
  morning: { id: 'm', icon: '📷', title: 'Morning', text: 'Sort a few.', opensAt: 'sort' },
  evening: { id: 'e', icon: '🌙', title: 'Evening', text: 'Still waiting.', opensAt: 'sort' },
};

describe('planReminders', () => {
  it("drops the evening nudge once the day's goal is met", () => {
    const plan = planReminders({ ...UNFINISHED_DAY, dayComplete: true }, MESSAGES);

    // Absent, not merely re-worded: the caller cancels every slot and schedules what comes back, so
    // leaving it out of the plan is what withdraws an alarm armed earlier in the day.
    expect(plan.map((r) => r.id)).not.toContain(EVENING_REMINDER_ID);
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
    const planned = planReminders(settings, { morning: null, evening: null });

    expect(planned.map((r) => r.id)).toEqual([MORNING_REMINDER_ID, EVENING_REMINDER_ID]);
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
    expect(planReminders(settings, { morning: null, evening: null })).toEqual([]);
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
