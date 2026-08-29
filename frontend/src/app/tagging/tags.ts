/**
 * A user-defined content tag (e.g. "Animals", "Family") — a per-photo label for later querying, kept
 * in a small catalog the user edits in Settings. Distinct from `AlbumTag`, which is an album *profile*
 * that changes review behaviour. `id` is stable so a rename updates every assignment for free.
 * Eventually maps to a Lightroom keyword. (Persisted by the `tags` store in photokeeper-db.)
 */
export interface Tag {
  id: string;
  name: string;
  color?: string; // optional chip colour
}

/** The eight swipe directions in Tag mode — the four axes plus the four corners. */
export type SwipeDir =
  'left' | 'right' | 'up' | 'down' | 'up-left' | 'up-right' | 'down-left' | 'down-right';

/** Direction → tag id. One entry per bound direction; a missing direction is unbound. */
export type TagDirections = Partial<Record<SwipeDir, string>>;

/**
 * The corner reserved for "this photo needs no tag".
 *
 * Fixed rather than assignable, because it is the answer every pass needs and the one the pool
 * depends on: photos are drawn from the *untagged* keepers, so without a way to say "none of these
 * apply" a photo you keep declining comes back for ever.
 */
export const NO_TAG_DIR: SwipeDir = 'down-right';

/**
 * The built-in tag that corner applies. Not part of the user's catalog — it cannot be renamed,
 * deleted, or bound to another direction — but it is a real assignment, which is what settles the
 * photo and takes it out of the pool.
 */
export const NO_TAG_ID = 'no-tag';

/** The built-in tag as a catalog entry, for anything that renders an applied tag by id. */
export const NO_TAG: Tag = { id: NO_TAG_ID, name: 'No tag' };

/** Fixed order for rendering the direction rows / edge labels: axes first, then corners. */
export const SWIPE_DIRS: readonly SwipeDir[] = [
  'left',
  'right',
  'up',
  'down',
  'up-left',
  'up-right',
  'down-left',
  'down-right',
];

/** The directions a user may bind a tag to — every one except the reserved corner. */
export const ASSIGNABLE_DIRS: readonly SwipeDir[] = SWIPE_DIRS.filter((dir) => dir !== NO_TAG_DIR);

/** Arrow glyph per direction, for labels. */
export const DIR_ARROW: Record<SwipeDir, string> = {
  'left': '←',
  'right': '→',
  'up': '↑',
  'down': '↓',
  'up-left': '↖',
  'up-right': '↗',
  'down-left': '↙',
  'down-right': '↘',
};

/** Human label per direction, for the Settings assignment rows. */
export const DIR_LABEL: Record<SwipeDir, string> = {
  'left': 'Left',
  'right': 'Right',
  'up': 'Up',
  'down': 'Down',
  'up-left': 'Up-left',
  'up-right': 'Up-right',
  'down-left': 'Down-left',
  'down-right': 'Down-right',
};

/**
 * The direction a drag vector points in, as one of eight equal 45° sectors centred on each arrow.
 *
 * Equal sectors on purpose: a corner is as easy to hit as an axis, so no direction is second-class.
 * `dy` grows downward, as pointer coordinates do.
 */
export function swipeDirOf(dx: number, dy: number): SwipeDir {
  // Sector index 0..7 starting at "right" and turning clockwise (down is positive y).
  const eighth = Math.round((Math.atan2(dy, dx) * 4) / Math.PI);
  const sector = ((eighth % 8) + 8) % 8;
  return CLOCKWISE_FROM_RIGHT[sector];
}

const CLOCKWISE_FROM_RIGHT: readonly SwipeDir[] = [
  'right',
  'down-right',
  'down',
  'down-left',
  'left',
  'up-left',
  'up',
  'up-right',
];

/**
 * The starting direction map, bound to the seeded default tags so swipe-to-tag works out of the box.
 * Reassignable in Settings → Tags; a binding to a since-deleted tag is simply ignored at use.
 */
export const DEFAULT_TAG_DIRECTIONS: TagDirections = {
  left: 'animals',
  right: 'family',
  up: 'friends',
  down: 'nature',
};
