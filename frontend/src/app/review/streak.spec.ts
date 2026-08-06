import { extendStreak, previousDay, streakOn } from './streak.service';
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
    expect(extendStreak(null, '2026-08-06')).toEqual({ days: 1, lastDay: '2026-08-06' });
  });

  it('counts a second goal on the same day only once', () => {
    const state = { days: 3, lastDay: '2026-08-06' };

    expect(extendStreak(state, '2026-08-06')).toEqual(state);
  });

  it('adds a day when yesterday was the last one', () => {
    expect(extendStreak({ days: 3, lastDay: '2026-08-05' }, '2026-08-06')).toEqual({
      days: 4,
      lastDay: '2026-08-06',
    });
  });

  it('starts again from one after a missed day', () => {
    expect(extendStreak({ days: 9, lastDay: '2026-08-04' }, '2026-08-06')).toEqual({
      days: 1,
      lastDay: '2026-08-06',
    });
  });
});

describe('streakOn', () => {
  it('is zero before the first goal is ever met', () => {
    expect(streakOn(null, '2026-08-06')).toBe(0);
  });

  it('shows the run on the day it was earned', () => {
    expect(streakOn({ days: 7, lastDay: '2026-08-06' }, '2026-08-06')).toBe(7);
  });

  it('still shows the run the day after, before today has been reviewed', () => {
    expect(streakOn({ days: 7, lastDay: '2026-08-05' }, '2026-08-06')).toBe(7);
  });

  it('drops to zero once a whole day has been missed', () => {
    expect(streakOn({ days: 7, lastDay: '2026-08-04' }, '2026-08-06')).toBe(0);
  });
});
