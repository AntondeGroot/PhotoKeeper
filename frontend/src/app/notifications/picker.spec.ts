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

  it('keeps matching a yearless day in every year', () => {
    const m = msg({ id: 'kd', type: 'date', date: { onDate: '27-04' } });
    expect(conditionMet(m, stats({ date: new Date('2026-04-27T10:00') }))).toBe(true);
    expect(conditionMet(m, stats({ date: new Date('2031-04-27T10:00') }))).toBe(true);
  });

  it('matches a year-qualified day only in that year (dd-MM-yyyy)', () => {
    const m = msg({ id: 'kd', type: 'date', date: { onDate: '26-04-2031' } });
    expect(conditionMet(m, stats({ date: new Date('2031-04-26T10:00') }))).toBe(true);
    expect(conditionMet(m, stats({ date: new Date('2032-04-26T10:00') }))).toBe(false);
    expect(conditionMet(m, stats({ date: new Date('2031-04-27T10:00') }))).toBe(false);
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

  it('wraps the new year when a recurring range ends before it starts', () => {
    // Winter, authored once: 21-12 → 20-03 reads as "late December onwards, or up to late March".
    const m = msg({ id: 'winter', type: 'date', date: { fromDate: '21-12', toDate: '20-03' } });
    expect(conditionMet(m, stats({ date: new Date('2026-12-25T10:00') }))).toBe(true);
    expect(conditionMet(m, stats({ date: new Date('2027-01-15T10:00') }))).toBe(true);
    expect(conditionMet(m, stats({ date: new Date('2026-01-15T10:00') }))).toBe(true);
    expect(conditionMet(m, stats({ date: new Date('2026-06-01T10:00') }))).toBe(false);
    expect(conditionMet(m, stats({ date: new Date('2026-03-21T10:00') }))).toBe(false);
  });

  it('never wraps a pinned range, so a backwards one matches nothing', () => {
    // Absolute ends make end-before-start a typo rather than an intent. Wrapping it would match
    // almost every day; matching nothing makes the mistake visible.
    const m = msg({
      id: 'typo',
      type: 'date',
      date: { fromDate: '21-12-2027', toDate: '20-03-2026' },
    });
    expect(conditionMet(m, stats({ date: new Date('2027-12-25T10:00') }))).toBe(false);
    expect(conditionMet(m, stats({ date: new Date('2026-02-10T10:00') }))).toBe(false);
    expect(conditionMet(m, stats({ date: new Date('2026-07-01T10:00') }))).toBe(false);
  });

  it('spans the year boundary when both range ends carry a year', () => {
    // Winter: only expressible because year-qualified ends are absolute points in time.
    const m = msg({
      id: 'winter',
      type: 'date',
      date: { fromDate: '21-12-2026', toDate: '20-03-2027' },
    });
    expect(conditionMet(m, stats({ date: new Date('2026-12-25T10:00') }))).toBe(true);
    expect(conditionMet(m, stats({ date: new Date('2027-01-15T10:00') }))).toBe(true);
    expect(conditionMet(m, stats({ date: new Date('2026-12-20T10:00') }))).toBe(false);
    expect(conditionMet(m, stats({ date: new Date('2027-03-21T10:00') }))).toBe(false);
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

  it('carries where the message opens the app, defaulting to the Sort step', () => {
    // Resolved at pick time because the tap may be hours later, on an app starting from cold.
    const editNudge = msg({ id: 'edit', opensAt: 'edit' });
    expect(pickNotification([editNudge], stats())?.opensAt).toBe('edit');
    expect(pickNotification([msg({ id: 'plain' })], stats())?.opensAt).toBe('sort');
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
