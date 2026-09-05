import { Injectable, computed, inject, signal } from '@angular/core';
import { PreferencesService } from '../preferences.service';
import { DayService } from './day.service';

const STORAGE_KEY = 'daily-progress';

/** The three ways a day's work can be done. */
export type DailyTask = 'reviews' | 'edits' | 'tags';

/** What has been done today, and on which day it was done. */
interface Progress {
  day: string;
  reviews: number;
  edits: number;
  tags: number;
}

const EMPTY = (day: string): Progress => ({ day, reviews: 0, edits: 0, tags: 0 });

/**
 * How much of today's work is done, across all three passes.
 *
 * <p>Kept here, and persisted, because the counts it needs are otherwise unrecoverable. Reviews can
 * be read back off the deck, but edits and tags were counted in memory and reset on reload — so
 * three edits done in two sittings added up to one, and a day's work finished that way never counted
 * for anything. A tally that forgets is worse than no tally: it turns "did you do your bit today?"
 * into "did you do it without closing the app?".
 *
 * <p>Reviews are *set* from the deck rather than incremented, so re-deciding a unit cannot inflate
 * them; edits and tags have nothing to be read back from and are counted as they happen.
 */
@Injectable({ providedIn: 'root' })
export class DailyProgressService {
  private readonly prefs = inject(PreferencesService);
  private readonly day = inject(DayService);
  private readonly stored = signal<Progress>(read());

  /**
   * Today's tally, zeroed the moment the day turns over.
   *
   * Derived rather than reset by a listener: a stored record for another day is simply not today's
   * progress, whether the app was open through midnight or opened fresh a week later. The write side
   * folds the same rule in, so a count recorded after the rollover starts from zero rather than
   * adding to yesterday.
   */
  private readonly progress = computed<Progress>(() => {
    const stored = this.stored();
    return stored.day === this.day.today() ? stored : EMPTY(this.day.today());
  });

  readonly reviews = computed(() => this.progress().reviews);
  readonly edits = computed(() => this.progress().edits);
  readonly tags = computed(() => this.progress().tags);

  /**
   * The task finished today, or null while none is — any one of the three counts as the day's work.
   *
   * A goal of zero is not a goal that is trivially met; it is a pass the user has turned off, and it
   * must never complete a day on its own.
   */
  readonly taskDone = computed<DailyTask | null>(() => {
    const done = this.progress();
    if (met(done.reviews, this.prefs.dailyGoal())) return 'reviews';
    if (met(done.edits, this.prefs.editGoal())) return 'edits';
    if (met(done.tags, this.prefs.tagGoal())) return 'tags';
    return null;
  });

  /** Records how many units of today's deck carry a verdict. Idempotent — the deck is the truth. */
  recordReviews(count: number): void {
    if (count === this.progress().reviews) return;
    this.write({ ...this.progress(), reviews: count });
  }

  recordEdit(): void {
    this.write({ ...this.progress(), edits: this.progress().edits + 1 });
  }

  recordTag(): void {
    this.write({ ...this.progress(), tags: this.progress().tags + 1 });
  }

  private write(next: Progress): void {
    const stamped = { ...next, day: this.day.today() };
    this.stored.set(stamped);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stamped));
    } catch {
      // A full or blocked quota costs the tally, never the review flow.
    }
  }
}

/** A pass counts as done only when it has a goal to reach and has reached it. */
function met(done: number, goal: number): boolean {
  return goal > 0 && done >= goal;
}

function read(): Progress {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (!isProgress(parsed)) return EMPTY('');
    return parsed;
  } catch {
    return EMPTY('');
  }
}

function isProgress(value: unknown): value is Progress {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<Progress>;
  return (
    typeof candidate.day === 'string' &&
    typeof candidate.reviews === 'number' &&
    typeof candidate.edits === 'number' &&
    typeof candidate.tags === 'number'
  );
}
