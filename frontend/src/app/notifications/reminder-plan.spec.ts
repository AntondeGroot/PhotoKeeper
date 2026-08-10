import {
  EVENING_REMINDER_ID,
  ReminderMessages,
  ReminderSettings,
  planReminders,
} from './reminder-plan';

/** Both slots on, both times valid, a day with work left — the shape every test varies one field of. */
const UNFINISHED_DAY: ReminderSettings = {
  morningEnabled: true,
  morningTime: '09:00',
  eveningEnabled: true,
  eveningTime: '21:00',
  dayComplete: false,
  pileCount: 12,
};

const MESSAGES: ReminderMessages = {
  morning: { id: 'm', icon: '📷', title: 'Morning', text: 'Sort a few.' },
  evening: { id: 'e', icon: '🌙', title: 'Evening', text: 'Still waiting.' },
};

describe('planReminders', () => {
  it("drops the evening nudge once the day's goal is met", () => {
    const plan = planReminders({ ...UNFINISHED_DAY, dayComplete: true }, MESSAGES);

    // Absent, not merely re-worded: the caller cancels every slot and schedules what comes back, so
    // leaving it out of the plan is what withdraws an alarm armed earlier in the day.
    expect(plan.map((r) => r.id)).not.toContain(EVENING_REMINDER_ID);
  });
});
