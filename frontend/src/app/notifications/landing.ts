/**
 * Where a notification puts the user when they tap it.
 *
 * A nudge is about something specific — an edit queue filling up, prints that arrived — and opening
 * on the Sort step regardless means the app answers a different question than the one it just asked.
 * So a message says where it leads, and that travels with the notification (as `extra`) all the way
 * to the tap, because by then the app may be starting from cold with nothing else to go on.
 */

/** The step a notification is about. Absent on a message means the daily review's Sort step. */
export type LandingSpot = 'sort' | 'edit' | 'tag' | 'prints';

/** Where that lands in the app's own navigation: a tab, and — inside Daily review — which step. */
export interface LandingTarget {
  tab: 'review' | 'prints';
  /** The review step to open, or null for a tab that has none. */
  mode: 'sort' | 'edit' | 'tag' | null;
}

const SPOTS: readonly string[] = ['sort', 'edit', 'tag', 'prints'];

/**
 * Whether a value off a notification payload is a spot this app knows.
 *
 * Worth checking: the payload was written by a *previous* version of the app — the OS held that
 * alarm for hours — so it can name a step this build no longer has.
 */
export function isLandingSpot(value: unknown): value is LandingSpot {
  return typeof value === 'string' && SPOTS.includes(value);
}

/**
 * The tab and review step to open for `spot`.
 *
 * Tagging is an optional step (Settings → Features), so a tag nudge from before it was switched off
 * falls back to Sort rather than opening a step that is not there.
 */
export function landingFor(spot: LandingSpot, taggingEnabled: boolean): LandingTarget {
  if (spot === 'prints') return { tab: 'prints', mode: null };
  if (spot === 'tag' && !taggingEnabled) return { tab: 'review', mode: 'sort' };
  return { tab: 'review', mode: spot };
}
