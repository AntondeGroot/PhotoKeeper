import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { TestBed } from '@angular/core/testing';
import { StreakService, StreakState } from './streak.service';
import { BacklogStatusService } from './backlog-status.service';
import { todayKey } from './review-feed.service';
import { previousDay } from './streak.service';

/** The stored run, as it would be found on disk when the app opens. */
function storeRun(days: number, lastDay: string, freezes: number): void {
  localStorage.setItem(
    'review-streak',
    JSON.stringify({ days, lastDay, lastMet: lastDay, freezes }),
  );
}

function readRun(): StreakState {
  return JSON.parse(localStorage.getItem('review-streak') ?? '{}') as StreakState;
}

/** Boots the service with a stated answer to "is there anything to do?". */
async function open(workWaiting: boolean): Promise<StreakService> {
  TestBed.configureTestingModule({
    providers: [
      {
        provide: BacklogStatusService,
        useValue: { hasWorkWaiting: () => Promise.resolve(workWaiting) },
      },
    ],
  });
  const service = TestBed.inject(StreakService);
  await new Promise((resolve) => setTimeout(resolve, 0)); // let the settle finish
  return service;
}

describe('StreakService', () => {
  beforeEach(() => {
    indexedDB = new IDBFactory();
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('spends a freeze on opening after a missed day, and persists the result', async () => {
    // Two days ago was the last goal met, so yesterday was missed. There is work waiting.
    storeRun(12, previousDay(previousDay(todayKey())), 2);

    const service = await open(true);

    expect(service.days()).toBe(12); // the run survived
    expect(service.freezes()).toBe(1); // one freeze paid for it
    expect(service.freezesJustUsed()).toBe(1); // and the notice is owed, for one day
    // Written through, so closing the app does not undo the payment or charge for it twice.
    expect(readRun()).toEqual({
      days: 12,
      lastDay: todayKey(),
      lastMet: previousDay(previousDay(todayKey())), // untouched: a freeze is not a session
      freezes: 1,
    });
  });

  it("lights the streak only once today's goal is met", async () => {
    // Yesterday's run: the count still shows, because a streak is broken by a missed day rather
    // than by a day not yet finished — but today's work is outstanding.
    storeRun(12, previousDay(todayKey()), 0);
    const service = await open(true);

    expect(service.days()).toBe(12);
    expect(service.metToday()).toBe(false);

    service.recordGoalMet();
    expect(service.days()).toBe(13);
    expect(service.metToday()).toBe(true);
  });

  it('reports the unlock only on the day the run earns a freeze', async () => {
    // Day 59 in the bank, and yesterday was the last one met — so today makes 60.
    storeRun(59, previousDay(todayKey()), 0);
    const service = await open(true);

    expect(service.recordGoalMet()).toBe(true);
    expect(service.freezes()).toBe(1);

    // Same day again (the goal celebration can re-fire) must not announce a second time.
    expect(service.recordGoalMet()).toBe(false);
    expect(service.freezes()).toBe(1);
  });

  it('leaves the streak unlit on a paused day, since no work was done', async () => {
    storeRun(12, previousDay(previousDay(todayKey())), 2);
    const service = await open(false); // nothing to do

    // The run is carried to today so it survives, but carrying is not keeping it up: the chip
    // reads "still standing", not "done today".
    expect(service.days()).toBe(12);
    expect(service.metToday()).toBe(false);
  });

  it('pauses instead of paying when the backlog is clear', async () => {
    // The same missed day as above — the only difference is that there was nothing to do.
    storeRun(12, previousDay(previousDay(todayKey())), 2);

    const service = await open(false);

    expect(service.days()).toBe(12);
    expect(service.freezes()).toBe(2); // untouched: you did not forget, you had finished
    expect(service.freezesJustUsed()).toBe(0); // so there is nothing to announce either
    expect(readRun()).toEqual({
      days: 12,
      lastDay: todayKey(),
      lastMet: previousDay(previousDay(todayKey())),
      freezes: 2,
    });
  });
});
