import { conditionMet, pickNotification, renderTemplate } from './picker';
import { NotificationMessage, ReviewStats } from './notification-message';

const stats = (over: Partial<ReviewStats> = {}): ReviewStats => ({
  date: new Date('2026-06-20T09:00:00'),
  pileCount: 12,
  streak: 7,
  editQueue: 2,
  printsArrived: 0,
  ...over,
});

const msg = (over: Partial<NotificationMessage> & { id: string }): NotificationMessage => ({
  type: 'evergreen',
  icon: '•',
  title: 't',
  text: 'x',
  ...over,
});

describe('conditionMet', () => {
  it('evergreen always applies', () => {
    expect(conditionMet(msg({ id: 'e' }), stats())).toBe(true);
  });

  it('matches a single-day date condition (dd-MM)', () => {
    const m = msg({ id: 'v', type: 'date', date: { onDate: '14-02' } });
    expect(conditionMet(m, stats({ date: new Date('2026-02-14T10:00') }))).toBe(true);
    expect(conditionMet(m, stats({ date: new Date('2026-02-15T10:00') }))).toBe(false);
  });

  it('matches an inclusive date range (dd-MM)', () => {
    const m = msg({ id: 'ny', type: 'date', date: { fromDate: '01-01', toDate: '07-01' } });
    expect(conditionMet(m, stats({ date: new Date('2026-01-01T00:00') }))).toBe(true);
    expect(conditionMet(m, stats({ date: new Date('2026-01-07T23:00') }))).toBe(true);
    expect(conditionMet(m, stats({ date: new Date('2026-01-08T00:00') }))).toBe(false);
  });

  it('compares ranges chronologically, not lexically, across a month boundary', () => {
    // 28-01 → 03-02 spans Jan→Feb; lexical string compare would wrongly exclude 1 Feb ("01-02").
    const m = msg({ id: 'span', type: 'date', date: { fromDate: '28-01', toDate: '03-02' } });
    expect(conditionMet(m, stats({ date: new Date('2026-02-01T10:00') }))).toBe(true);
    expect(conditionMet(m, stats({ date: new Date('2026-01-30T10:00') }))).toBe(true);
    expect(conditionMet(m, stats({ date: new Date('2026-02-04T10:00') }))).toBe(false);
  });

  it('matches stat conditions from the fixed vocabulary', () => {
    expect(conditionMet(msg({ id: 'p', type: 'stat', stat: { pileAtLeast: 10 } }), stats())).toBe(
      true,
    );
    expect(conditionMet(msg({ id: 'p', type: 'stat', stat: { pileAtLeast: 20 } }), stats())).toBe(
      false,
    );
    const streak = msg({ id: 's', type: 'stat', stat: { streakReaches: [7, 14] } });
    expect(conditionMet(streak, stats({ streak: 7 }))).toBe(true);
    expect(conditionMet(streak, stats({ streak: 8 }))).toBe(false);
    const prints = msg({ id: 'pr', type: 'stat', stat: { printsAwaiting: true } });
    expect(conditionMet(prints, stats({ printsArrived: 0 }))).toBe(false);
    expect(conditionMet(prints, stats({ printsArrived: 2 }))).toBe(true);
  });
});

describe('renderTemplate', () => {
  it('fills whitelisted vars and leaves unknown tokens intact', () => {
    expect(renderTemplate('Day {{streak}} — {{pileCount}} waiting', stats())).toBe(
      'Day 7 — 12 waiting',
    );
    expect(renderTemplate('hello {{nope}}', stats())).toBe('hello {{nope}}');
  });
});

describe('pickNotification', () => {
  it('returns null when nothing is eligible', () => {
    const catalog = [msg({ id: 'a', type: 'stat', stat: { pileAtLeast: 999 } })];
    expect(pickNotification(catalog, stats())).toBeNull();
  });

  it('prefers higher priority (date beats evergreen by default)', () => {
    const catalog = [
      msg({ id: 'ever' }),
      msg({ id: 'day', type: 'date', date: { onDate: '20-06' } }),
    ];
    expect(pickNotification(catalog, stats())?.id).toBe('day');
  });

  it('honours an explicit priority over the type default', () => {
    const catalog = [
      msg({ id: 'day', type: 'date', date: { onDate: '20-06' } }), // default priority 3
      msg({ id: 'urgent', type: 'stat', stat: { pileAtLeast: 1 }, priority: 9 }),
    ];
    expect(pickNotification(catalog, stats())?.id).toBe('urgent');
  });

  it('renders the chosen message with the live stats', () => {
    const catalog = [
      msg({ id: 's', type: 'stat', stat: { streakReaches: [7] }, title: 'Day {{streak}}' }),
    ];
    expect(pickNotification(catalog, stats())?.title).toBe('Day 7');
  });

  it('skips a message still within its cooldown', () => {
    const m = msg({ id: 'a', cooldownDays: 3 });
    const lastShown = new Date('2026-06-19T09:00:00').getTime(); // 1 day ago < 3-day cooldown
    expect(pickNotification([m], stats(), { a: lastShown })).toBeNull();
    const old = new Date('2026-06-10T09:00:00').getTime(); // 10 days ago ≥ cooldown
    expect(pickNotification([m], stats(), { a: old })?.id).toBe('a');
  });

  it('rotates among equal-priority fillers via the rng tiebreak', () => {
    const catalog = [msg({ id: 'a' }), msg({ id: 'b' }), msg({ id: 'c' })];
    expect(pickNotification(catalog, stats(), {}, () => 0)?.id).toBe('a');
    expect(pickNotification(catalog, stats(), {}, () => 0.5)?.id).toBe('b');
    expect(pickNotification(catalog, stats(), {}, () => 0.99)?.id).toBe('c');
  });
});
