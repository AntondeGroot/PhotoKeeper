import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ReminderSchedulerService } from './reminder-scheduler.service';
import { NotificationService } from './notification.service';
import { OS_REMINDERS } from './os-reminders';
import { PlannedReminder } from './reminder-plan';
import { PreferencesService } from '../preferences.service';
import { ReviewStatsService } from '../review/review-stats.service';
import { ReviewDecisionsService } from '../review/review-decisions.service';
import { BacklogStatusService } from '../review/backlog-status.service';
import { ReviewBufferService } from '../review/review-buffer.service';
import { AlbumPrintStore } from '../storage/review/album-print-store';

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('ReminderSchedulerService', () => {
  let applied: PlannedReminder[][];
  let workWaiting: boolean;
  let backlogCount: ReturnType<typeof signal<number>>;
  let scans: number;

  function make(buffered = 0): ReminderSchedulerService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: OS_REMINDERS,
          useValue: {
            ensurePermission: () => Promise.resolve(true),
            apply: (r: PlannedReminder[]) => {
              applied.push(r);
              return Promise.resolve();
            },
          },
        },
        { provide: NotificationService, useValue: { pick: () => null } },
        { provide: ReviewBufferService, useValue: { available: () => buffered } },
        {
          provide: BacklogStatusService,
          useValue: {
            hasWorkWaiting: () => {
              scans++;
              return Promise.resolve(workWaiting);
            },
          },
        },
        { provide: AlbumPrintStore, useValue: { getAll: () => Promise.resolve(new Map()) } },
        {
          provide: PreferencesService,
          useValue: {
            morningReminder: () => true,
            reminderTime: () => '09:00',
            silentEvening: () => false,
            silentTime: () => '21:00',
            dailyGoal: () => 15,
          },
        },
        {
          provide: ReviewStatsService,
          useValue: { doneToday: () => 0, backlogCount, toEditQueue: () => [] },
        },
        { provide: ReviewDecisionsService, useValue: { streakDays: () => 3 } },
      ],
    });
    return TestBed.inject(ReminderSchedulerService);
  }

  beforeEach(() => {
    applied = [];
    scans = 0;
    workWaiting = true;
    backlogCount = signal(12);
  });

  it('settles it from the buffer alone when photos are queued', async () => {
    // A stocked buffer is unseen photos by definition, so the answer is already known. The scan
    // reads the whole asset table and every verdict; doing that to learn what the queue already
    // says would be work for nothing, on by far the commonest path.
    make(42);
    await settle();

    expect(applied.at(-1)?.map((r) => r.id)).toEqual([1]);
    expect(scans).toBe(0);
  });

  it("withdraws tomorrow's reminder when the last photo is decided mid-session", async () => {
    make();
    await settle();
    // Something to do, so the morning nudge stands — from the fallback text, since the catalog
    // here has nothing to offer.
    expect(applied.at(-1)?.map((r) => r.id)).toEqual([1]);

    // The last photo is decided: the deck empties and, this time, so does the library.
    workWaiting = false;
    backlogCount.set(0);
    await settle(); // the empty deck reschedules, still believing there is work in the library
    await settle(); // ...then the re-read lands and corrects it

    // Whatever is scheduled at the moment the app is closed is what fires tomorrow, so the plan
    // has to be corrected here rather than on the next launch.
    expect(applied.at(-1)).toEqual([]);
  });
});
