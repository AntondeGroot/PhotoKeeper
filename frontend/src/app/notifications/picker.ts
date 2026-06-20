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

/** `dd-MM` for a date, in local time (matches how date conditions are authored). */
function dayMonth(date: Date): string {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${d}-${m}`;
}

/** A `dd-MM` string as a month-major ordinal (month×100 + day), so ranges compare chronologically. */
function ordinalOf(dayMonthStr: string): number {
  const [day, month] = dayMonthStr.split('-').map(Number);
  return month * 100 + day;
}

function dateMatches(cond: DateCondition, date: Date): boolean {
  if ('onDate' in cond) return dayMonth(date) === cond.onDate;
  // Numeric (not lexical) compare: "31-01" must sort before "01-02". Inclusive; no year-boundary wrap.
  const today = (date.getMonth() + 1) * 100 + date.getDate();
  return ordinalOf(cond.fromDate) <= today && today <= ordinalOf(cond.toDate);
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
