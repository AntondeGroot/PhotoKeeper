// Which day it is, in local terms — the one answer the whole review flow is keyed on.
//
// Local rather than UTC, and computed rather than stored: a day is what the user's calendar says,
// so "today" changes at their midnight and not at anybody else's.

/** Local-date key (YYYY-MM-DD), so the daily selection doesn't flip a day early/late at UTC midnight. */
export function dateKey(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/**
 * Whether a value is a day key of the shape {@link dateKey} produces.
 *
 * Lives here rather than beside either of the things that validate stored state, because both are
 * asking the same question about the same format, and a second copy of the pattern is a second thing
 * to get wrong when the format changes.
 */
export function isDayKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function todayKey(): string {
  return dateKey(new Date());
}

export function tomorrowKey(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return dateKey(d);
}

/**
 * The header's date line, e.g. "Tuesday 9 June".
 *
 * <p>Fixed to en-GB rather than the device locale: the rest of the interface is written in English,
 * and a Dutch weekday under an English wordmark reads as a bug rather than as localisation. When the
 * app is actually translated, this should follow whatever that chooses.
 */
export function dayLabel(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(d);
}

/**
 * Milliseconds from `now` until the next local midnight, plus a second's grace so the timer cannot
 * land a hair *before* the date turns over and read the old day back.
 */
export function msUntilNextDay(now: Date): number {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
  return midnight.getTime() - now.getTime();
}
