import { extendStreak, previousDay, settleStreak, streakOn, StreakState } from './streak.service';

/** A run, with no banked freezes unless a test is about them. */
const run = (days: number, lastDay: string, freezes = 0, lastMet = lastDay): StreakState => ({
  days,
  lastDay,
  lastMet,
  freezes,
});
describe('previousDay', () => {
  it('steps back across a month boundary', () => {
    expect(previousDay('2026-08-01')).toBe('2026-07-31');
  });

  it('steps back across a leap day', () => {
    expect(previousDay('2026-03-01')).toBe('2026-02-28');
    expect(previousDay('2024-03-01')).toBe('2024-02-29');
  });
});

describe('extendStreak', () => {
  it('starts at one when there is no run yet', () => {
    expect(extendStreak(null, '2026-08-06')).toEqual(run(1, '2026-08-06'));
  });

  it('counts a second goal on the same day only once', () => {
    const state = run(3, '2026-08-06');

    expect(extendStreak(state, '2026-08-06')).toEqual(state);
  });

  it('adds a day when yesterday was the last one', () => {
    expect(extendStreak(run(3, '2026-08-05'), '2026-08-06')).toEqual(run(4, '2026-08-06'));
  });

  it('banks a freeze each time the run reaches sixty days, up to three', () => {
    // The day the run ticks over to 60 earns one...
    expect(extendStreak(run(59, '2026-08-05', 0), '2026-08-06')).toEqual(run(60, '2026-08-06', 1));
    // ...and the day after does not, or every day past 60 would earn one.
    expect(extendStreak(run(60, '2026-08-05', 1), '2026-08-06')).toEqual(run(61, '2026-08-06', 1));
    // 120 is the next, and so on.
    expect(extendStreak(run(119, '2026-08-05', 1), '2026-08-06')).toEqual(
      run(120, '2026-08-06', 2),
    );
    // Already holding the maximum: the milestone passes without a fourth.
    expect(extendStreak(run(179, '2026-08-05', 3), '2026-08-06')).toEqual(
      run(180, '2026-08-06', 3),
    );
  });

  it('starts again from one after a missed day', () => {
    expect(extendStreak(run(9, '2026-08-04'), '2026-08-06')).toEqual(run(1, '2026-08-06'));
  });
});

describe('settleStreak', () => {
  it('spends a freeze to cover a day that was missed', () => {
    // Goal last met on Monday, app opened on Wednesday: Tuesday was missed, and there is work
    // waiting — so this is a genuine forgotten day, which is what a freeze is for.
    const settled = settleStreak(run(12, '2026-08-03', 2), '2026-08-05', true);

    expect(settled.freezesUsed).toBe(1);
    // lastMet stays on the 3rd: a freeze keeps the run alive, it does not do the work for you.
    expect(settled.state).toEqual(run(12, '2026-08-05', 1, '2026-08-03'));
    // The run is carried to today, so it reads as intact rather than as a dead 12.
    expect(streakOn(settled.state, '2026-08-05')).toBe(12);
  });

  it('skips a gap with nothing to do, spending no freeze however long it runs', () => {
    // Backlog cleared on 3 August, prints still in the post, nothing to sort until the 20th.
    const settled = settleStreak(run(12, '2026-08-03', 2), '2026-08-20', false);

    expect(settled.paused).toBe(true);
    expect(settled.freezesUsed).toBe(0);
    // Seventeen days on, the run is untouched and still worth 12 — freezes are for forgetting,
    // not for having finished everything.
    // Carried to the 20th to stay alive, but the goal was last met on the 3rd.
    expect(settled.state).toEqual(run(12, '2026-08-20', 2, '2026-08-03'));
    expect(streakOn(settled.state, '2026-08-20')).toBe(12);
  });

  it('breaks when the gap outruns the banked freezes', () => {
    // Three days missed with only two freezes: they cover Tue and Wed, nothing covers Thu.
    const settled = settleStreak(run(40, '2026-08-03', 2), '2026-08-07', true);

    expect(settled.freezesUsed).toBe(2); // spent, not refunded — they did cover two of the days
    expect(settled.state).toEqual(run(0, '2026-08-07', 0, ''));
    expect(streakOn(settled.state, '2026-08-07')).toBe(0);
  });

  it('resumes a paused run at its old length when new photos arrive', () => {
    // Dormant since 3 August. The app is opened on the 20th and there is still nothing to do.
    const dormant = settleStreak(run(12, '2026-08-03', 2), '2026-08-20', false);

    // Photos land overnight; the goal is met on the 21st. The run picks up at 13, not at 1 —
    // which is the whole point of pausing rather than quietly letting it lapse.
    expect(extendStreak(dormant.state, '2026-08-21')).toEqual(run(13, '2026-08-21', 2));
  });
});

describe('streakOn', () => {
  it('is zero before the first goal is ever met', () => {
    expect(streakOn(null, '2026-08-06')).toBe(0);
  });

  it('shows the run on the day it was earned', () => {
    expect(streakOn(run(7, '2026-08-06'), '2026-08-06')).toBe(7);
  });

  it('still shows the run the day after, before today has been reviewed', () => {
    expect(streakOn(run(7, '2026-08-05'), '2026-08-06')).toBe(7);
  });

  it('drops to zero once a whole day has been missed', () => {
    expect(streakOn(run(7, '2026-08-04'), '2026-08-06')).toBe(0);
  });
});
