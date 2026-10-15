import { TestBed } from '@angular/core/testing';
import { DayService } from './day.service';
import { dateKey, msUntilNextDay } from './day';

describe('DayService', () => {
  let service: DayService;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    service?.dispose();
    vi.useRealTimers();
  });

  /** Builds the service with the clock at a fixed local moment. */
  function atLocalTime(iso: string): DayService {
    vi.setSystemTime(new Date(iso));
    service = TestBed.inject(DayService);
    return service;
  }

  it('reports the local day', () => {
    expect(atLocalTime('2026-06-14T22:30:00').today()).toBe('2026-06-14');
  });

  // The bug: an app left open overnight went on showing the previous day's finished deck, because
  // nothing ever asked what day it was a second time.
  it('turns the day over on its own at midnight', () => {
    const day = atLocalTime('2026-06-14T23:59:00');

    vi.advanceTimersByTime(msUntilNextDay(new Date()) + 100);

    expect(day.today()).toBe('2026-06-15');
  });

  // The commoner case by far: the machine was asleep at midnight, so the timer never fired on time.
  // Coming back to the app is what has to catch it.
  it('turns the day over when the app is looked at again', () => {
    const day = atLocalTime('2026-06-14T23:59:00');

    vi.setSystemTime(new Date('2026-06-16T09:00:00'));
    window.dispatchEvent(new Event('focus'));

    expect(day.today()).toBe('2026-06-16');
  });

  it('leaves the day alone when nothing has changed', () => {
    const day = atLocalTime('2026-06-14T10:00:00');
    const before = day.label();

    vi.setSystemTime(new Date('2026-06-14T18:00:00'));
    window.dispatchEvent(new Event('focus'));

    expect(day.today()).toBe('2026-06-14');
    expect(day.label()).toBe(before);
  });

  it('spells the day out for the header', () => {
    expect(atLocalTime('2026-06-14T10:00:00').label()).toBe('Sunday 14 June');
  });

  it('keys a date by local time, not UTC', () => {
    // Late evening in a positive-offset zone is already tomorrow in UTC; the deck must not flip.
    expect(dateKey(new Date(2026, 5, 14, 23, 30))).toBe('2026-06-14');
  });
});
