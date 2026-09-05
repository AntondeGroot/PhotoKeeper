import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { DailyProgressService } from './daily-progress.service';
import { DayService } from './day.service';
import { PreferencesService } from '../preferences.service';

describe('DailyProgressService', () => {
  let progress: DailyProgressService;
  let today: ReturnType<typeof signal<string>>;

  const GOALS = { dailyGoal: () => 15, editGoal: () => 3, tagGoal: () => 15 };

  function build(goals: Partial<typeof GOALS> = {}): DailyProgressService {
    today = signal('2026-06-14');
    TestBed.resetTestingModule(); // build() is also used mid-test to stand the service up again
    TestBed.configureTestingModule({
      providers: [
        { provide: DayService, useValue: { today } },
        { provide: PreferencesService, useValue: { ...GOALS, ...goals } },
      ],
    });
    return TestBed.inject(DailyProgressService);
  }

  beforeEach(() => {
    localStorage.removeItem('daily-progress');
    progress = build();
  });

  // The rule the streak hangs off: a day is done by finishing a pass, not by touching one.
  it('is not done until a pass is actually finished', () => {
    progress.recordReviews(14);

    expect(progress.taskDone()).toBeNull();

    progress.recordReviews(15);

    expect(progress.taskDone()).toBe('reviews');
  });

  // Sorting used to be the only pass that counted, so a day spent entirely on editing or tagging
  // was a day the streak treated as missed however much work went into it.
  it('counts a day of editing as a day', () => {
    progress.recordEdit();
    progress.recordEdit();

    expect(progress.taskDone()).toBeNull();

    progress.recordEdit();

    expect(progress.taskDone()).toBe('edits');
  });

  it('counts a day of tagging as a day', () => {
    for (let i = 0; i < 15; i++) progress.recordTag();

    expect(progress.taskDone()).toBe('tags');
  });

  // A goal of zero is a pass switched off, not a pass trivially finished.
  it('never completes a day on a pass that has no goal', () => {
    progress = build({ editGoal: () => 0 });

    expect(progress.taskDone()).toBeNull();
  });

  // Edits and tags were counted in memory before, so three edits done in two sittings added up to
  // one and the day never counted for anything.
  it('remembers a partly-done pass across a reload', () => {
    progress.recordEdit();
    progress.recordEdit();

    const reopened = build();

    expect(reopened.edits()).toBe(2);
    reopened.recordEdit();
    expect(reopened.taskDone()).toBe('edits');
  });

  it('starts from nothing when the day turns over', () => {
    progress.recordEdit();
    progress.recordEdit();
    progress.recordReviews(15);
    expect(progress.taskDone()).toBe('reviews');

    today.set('2026-06-15');

    expect(progress.edits()).toBe(0);
    expect(progress.reviews()).toBe(0);
    expect(progress.taskDone()).toBeNull();
  });

  // Reviews come off the deck rather than being counted per swipe, so revisiting a decision cannot
  // inflate them.
  it('takes the review count as given rather than adding it up', () => {
    progress.recordReviews(5);
    progress.recordReviews(5);
    progress.recordReviews(4);

    expect(progress.reviews()).toBe(4);
  });
});
