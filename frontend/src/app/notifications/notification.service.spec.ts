import { TestBed } from '@angular/core/testing';
import { NotificationService } from './notification.service';
import { NOTIFICATION_SENDER, NotificationSender } from './notification-sender';
import { RenderedNotification, ReviewStats } from './notification-message';

const stats = (over: Partial<ReviewStats> = {}): ReviewStats => ({
  date: new Date('2026-06-20T09:00:00'),
  pileCount: 12,
  streak: 7,
  editQueue: 2,
  printsArrived: 0,
  ...over,
});

describe('NotificationService', () => {
  let service: NotificationService;
  let sent: RenderedNotification[];

  beforeEach(() => {
    localStorage.clear();
    sent = [];
    const senderStub: NotificationSender = {
      send: (n) => {
        sent.push(n);
        return Promise.resolve();
      },
    };
    TestBed.configureTestingModule({
      providers: [{ provide: NOTIFICATION_SENDER, useValue: senderStub }],
    });
    service = TestBed.inject(NotificationService);
    service.rng = () => 0; // deterministic tiebreak
  });

  it('sends the picked notification and returns it', async () => {
    // 2026-06-20 is mid-year with default stats → a stat/evergreen message picks; just assert one fired.
    const result = await service.maybeNotify(stats());
    expect(result).not.toBeNull();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual(result);
  });

  it('records a cooldown so the same message is not re-sent immediately', async () => {
    const first = await service.maybeNotify(stats());
    const second = await service.maybeNotify(stats()); // same day → first message is on cooldown

    expect(second?.id).not.toBe(first?.id); // a different message, or null
    expect(sent.map((n) => n.id)).not.toEqual([first?.id, first?.id]);
  });

  it('persists cooldown history to localStorage', async () => {
    const result = await service.maybeNotify(stats());
    const stored: unknown = JSON.parse(localStorage.getItem('headsUpHistory') ?? '{}');
    expect((stored as Record<string, number>)[result!.id]).toBe(stats().date.getTime());
  });

  it('chooses the date-themed message over evergreen on a holiday (real catalog)', async () => {
    const result = await service.maybeNotify(stats({ date: new Date('2026-02-14T09:00:00') }));
    expect(result?.id).toBe('valentines');
  });
});
