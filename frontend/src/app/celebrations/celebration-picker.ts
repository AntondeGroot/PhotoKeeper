import { dateMatches } from '../notifications/picker';
import {
  CelebrationContext,
  CelebrationImage,
  CelebrationTrigger,
  CounterTrigger,
  ShownLog,
} from './celebration.types';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How narrow a trigger is. Ties break toward the more specific image: on 14 February both
 * `valentine` and `winter` are eligible, and without this the seasonal one drowns the special one
 * simply by being eligible for ninety days against its one. A single day is narrower than a season.
 */
const WEIGHT = { exactDate: 5, dateRange: 3, event: 3, counter: 3, always: 1 } as const;

function weightOf(image: CelebrationImage): number {
  const when: CelebrationTrigger = image.when;
  if ('date' in when) return 'onDate' in when.date ? WEIGHT.exactDate : WEIGHT.dateRange;
  if ('event' in when) return WEIGHT.event;
  if ('counter' in when) return WEIGHT.counter;
  return WEIGHT.always;
}

/**
 * The highest milestone this counter has passed, or null if it hasn't reached one (or isn't
 * tracked). Deliberately "passed", not "landed on": totals are sampled when a slot opens, so a
 * session that carries you from 95 to 107 must still count as reaching 100.
 */
function milestoneOf(when: CounterTrigger, context: CelebrationContext): number | null {
  const value = context.counters?.[when.counter];
  if (value === undefined) return null;

  const reached = 'every' in when ? lastMultiple(value, when.every) : lastRung(value, when.reaches);
  return reached > 0 ? reached : null;
}

/** The highest multiple of `step` at or below `value`. A non-positive step reaches nothing. */
function lastMultiple(value: number, step: number): number {
  return step > 0 ? Math.floor(value / step) * step : 0;
}

/** The highest listed rung at or below `value`, or 0 if it hasn't reached the first one. */
function lastRung(value: number, rungs: number[]): number {
  return Math.max(0, ...rungs.filter((rung) => rung <= value));
}

function triggerHolds(when: CelebrationTrigger, context: CelebrationContext): boolean {
  if ('always' in when) return true;
  if ('date' in when) return dateMatches(when.date, context.date);
  if ('event' in when) return context.event === when.event;
  return milestoneOf(when, context) !== null;
}

/**
 * The scope key a guarantee claim is filed under — the thing that makes this occasion *this* one
 * rather than next year's. Returns null when the image makes no claim.
 */
export function claimKey(image: CelebrationImage, context: CelebrationContext): string | null {
  if (!image.guarantee) return null;
  if (image.guarantee === 'once') return 'once';
  if (image.guarantee === 'perYear') return String(context.date.getFullYear());
  if (!('counter' in image.when)) return null; // perThreshold without a counter claims nothing

  // Keyed by the milestone, not the current total — otherwise every extra photo would look like a
  // fresh occasion and the image would fire on every session once past the first rung.
  const milestone = milestoneOf(image.when, context);
  return milestone === null ? null : `${image.when.counter}:${milestone}`;
}

function withinBudget(
  image: CelebrationImage,
  context: CelebrationContext,
  log: ShownLog,
): boolean {
  const record = log[image.id];
  if (!record) return true; // never shown
  if (image.maxShows !== undefined && record.count >= image.maxShows) return false;
  const cooldown = (image.cooldownDays ?? 0) * DAY_MS;
  return context.date.getTime() - record.lastShown >= cooldown;
}

/** Eligible = its trigger holds now, and it hasn't used up its budget. */
function eligible(catalog: CelebrationImage[], context: CelebrationContext, log: ShownLog) {
  return catalog.filter((i) => triggerHolds(i.when, context) && withinBudget(i, context, log));
}

/** An unspent claim on this occasion. A spent one doesn't disqualify the image — it just drops it
 *  back into the pool, which is the "shown once, then random" behaviour. */
function hasUnspentClaim(image: CelebrationImage, context: CelebrationContext, log: ShownLog) {
  const key = claimKey(image, context);
  return key !== null && !(log[image.id]?.claims ?? []).includes(key);
}

function weightedPick(images: CelebrationImage[], rng: () => number): CelebrationImage {
  const total = images.reduce((sum, i) => sum + weightOf(i), 0);
  let ticket = rng() * total;
  for (const image of images) {
    ticket -= weightOf(image);
    if (ticket < 0) return image;
  }
  return images[images.length - 1];
}

/**
 * Picks the celebration image to show now, or null if nothing qualifies.
 *
 * A two-stage ladder. Any eligible image holding an unspent guarantee claim wins outright — the
 * narrowest one, so an exact date beats a season — because an image that must not be missed cannot
 * be left to chance. Otherwise it's a weighted random draw over everything eligible.
 *
 * Pure: the caller supplies the log and gets back a choice. Recording the showing (and spending the
 * claim) is {@link recordShown}, so a caller that only wants to *know* the pick doesn't mutate it.
 */
export function pickCelebration(
  catalog: CelebrationImage[],
  context: CelebrationContext,
  log: ShownLog = {},
  rng: () => number = Math.random,
): CelebrationImage | null {
  const candidates = eligible(catalog, context, log);
  if (candidates.length === 0) return null;

  const claimants = candidates.filter((i) => hasUnspentClaim(i, context, log));
  if (claimants.length === 0) return weightedPick(candidates, rng);

  let narrowest = claimants[0];
  for (const image of claimants) {
    if (weightOf(image) > weightOf(narrowest)) narrowest = image;
  }
  return narrowest;
}

/**
 * The log after showing `image` — bumps its counters and spends any claim it was holding.
 * Returns a new log rather than mutating, so the caller decides when to persist.
 */
export function recordShown(
  image: CelebrationImage,
  context: CelebrationContext,
  log: ShownLog,
): ShownLog {
  const previous = log[image.id] ?? { lastShown: 0, count: 0, claims: [] };
  const key = claimKey(image, context);
  const claims =
    key !== null && !previous.claims.includes(key) ? [...previous.claims, key] : previous.claims;

  return {
    ...log,
    [image.id]: { lastShown: context.date.getTime(), count: previous.count + 1, claims },
  };
}
