/** The four swipe directions a tag can be bound to in Tag mode. */
export type SwipeDir = 'left' | 'right' | 'up' | 'down';

/** Direction → tag id. At most four entries (one per direction); a missing direction is unbound. */
export type TagDirections = Partial<Record<SwipeDir, string>>;

/** Fixed order for rendering the direction rows / edge labels. */
export const SWIPE_DIRS: readonly SwipeDir[] = ['left', 'right', 'up', 'down'];

/** Arrow glyph per direction, for labels. */
export const DIR_ARROW: Record<SwipeDir, string> = {
  left: '←',
  right: '→',
  up: '↑',
  down: '↓',
};

/** Human label per direction, for the Settings assignment rows. */
export const DIR_LABEL: Record<SwipeDir, string> = {
  left: 'Left',
  right: 'Right',
  up: 'Up',
  down: 'Down',
};

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
