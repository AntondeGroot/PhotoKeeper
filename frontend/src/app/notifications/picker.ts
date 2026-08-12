import {
  DateCondition,
  DEFAULT_PRIORITY,
  NotificationMessage,
  RenderedNotification,
  ReviewStats,
  StatCondition,
  TEMPLATE_VARS,
} from './notification-message';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A date spec as a year-major ordinal (year×10000 + month×100 + day), so dates compare
 * chronologically with a numeric (not lexical) compare — "31-01" must sort before "01-02".
 *
 * A spec without a year (`dd-MM`) takes the year being tested, which is what makes it recur
 * annually. One with a year (`dd-MM-yyyy`) keeps it, pinning the condition to that year alone.
 */
function ordinalOf(spec: string, yearIfAbsent: number): number {
  const [day, month, year] = spec.split('-').map(Number);
  return (year ?? yearIfAbsent) * 10000 + month * 100 + day;
}

/** The date under test, in local time (matching how date conditions are authored). */
function ordinalOfDate(date: Date): number {
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}

/** Whether a spec pins a year (`dd-MM-yyyy`) rather than recurring (`dd-MM`). */
function hasYear(spec: string): boolean {
  return spec.split('-').length === 3;
}

function dateMatches(cond: DateCondition, date: Date): boolean {
  const today = ordinalOfDate(date);
  const year = date.getFullYear();
  if ('onDate' in cond) return ordinalOf(cond.onDate, year) === today;

  const from = ordinalOf(cond.fromDate, year);
  const to = ordinalOf(cond.toDate, year);
  if (from <= to) return from <= today && today <= to; // inclusive, within one year

  // A recurring range that ends before it starts wraps the new year: 21-12 → 20-03 reads as
  // "from late December onwards, or up until late March". Both ends took the year under test,
  // so each half of the comparison already sits in the right year.
  //
  // Only recurring ranges wrap. With years pinned the ends are absolute, so end-before-start is
  // a typo, not an intent — matching nothing surfaces that, where wrapping would silently match
  // almost every day.
  if (hasYear(cond.fromDate) || hasYear(cond.toDate)) return false;
  return today >= from || today <= to;
}

function statMatches(cond: StatCondition, stats: ReviewStats): boolean {
  if ('pileAtLeast' in cond) return stats.pileCount >= cond.pileAtLeast;
  if ('streakReaches' in cond) return cond.streakReaches.includes(stats.streak);
  if ('editQueueAtLeast' in cond) return stats.editQueue >= cond.editQueueAtLeast;
  return stats.printsArrived > 0; // printsAwaiting
}

/** Whether a message's trigger condition holds for the current stats. */
export function conditionMet(message: NotificationMessage, stats: ReviewStats): boolean {
  if (message.type === 'date') return !!message.date && dateMatches(message.date, stats.date);
  if (message.type === 'stat') return !!message.stat && statMatches(message.stat, stats);
  return true; // evergreen always applies
}

/** Whether enough time has passed since this message was last shown (per its cooldown). */
function offCooldown(
  message: NotificationMessage,
  stats: ReviewStats,
  history: Record<string, number>,
): boolean {
  if (!(message.id in history)) return true; // never shown
  const last = history[message.id];
  return stats.date.getTime() - last >= (message.cooldownDays ?? 0) * DAY_MS;
}

function priorityOf(message: NotificationMessage): number {
  return message.priority ?? DEFAULT_PRIORITY[message.type];
}

/** Substitutes the whitelisted {{vars}} in a string from the stats; unknown tokens are left intact. */
export function renderTemplate(template: string, stats: ReviewStats): string {
  return template.replace(/\{\{(\w+)\}\}/g, (whole, key: string) =>
    (TEMPLATE_VARS as readonly string[]).includes(key)
      ? String(stats[key as (typeof TEMPLATE_VARS)[number]])
      : whole,
  );
}

/**
 * Picks the single best notification to show now, or null if nothing qualifies. Eligible = condition
 * holds AND off cooldown. Among the eligible, the highest priority wins (date > stat > evergreen by
 * default), with a random tiebreak so equal-priority fillers rotate rather than always firing the
 * first. The chosen message's title/text are rendered with the live stats before returning.
 */
export function pickNotification(
  catalog: NotificationMessage[],
  stats: ReviewStats,
  history: Record<string, number> = {},
  rng: () => number = Math.random,
): RenderedNotification | null {
  const eligible = catalog.filter((m) => conditionMet(m, stats) && offCooldown(m, stats, history));
  if (eligible.length === 0) return null;

  const topPriority = Math.max(...eligible.map(priorityOf));
  const contenders = eligible.filter((m) => priorityOf(m) === topPriority);
  const chosen = contenders[Math.floor(rng() * contenders.length)] ?? contenders[0];

  return {
    id: chosen.id,
    icon: chosen.icon,
    title: renderTemplate(chosen.title, stats),
    text: renderTemplate(chosen.text, stats),
  };
}
