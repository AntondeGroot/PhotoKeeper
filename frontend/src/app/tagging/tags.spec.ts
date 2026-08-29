import { ASSIGNABLE_DIRS, NO_TAG_DIR, SWIPE_DIRS, SwipeDir, swipeDirOf } from './tags';

describe('swipeDirOf', () => {
  /** Straight along each axis and squarely into each corner. */
  const cardinal: [number, number, SwipeDir][] = [
    [100, 0, 'right'],
    [-100, 0, 'left'],
    [0, -100, 'up'],
    [0, 100, 'down'],
    [80, 80, 'down-right'],
    [-80, 80, 'down-left'],
    [80, -80, 'up-right'],
    [-80, -80, 'up-left'],
  ];

  it.each(cardinal)('reads (%i, %i) as %s', (dx, dy, expected) => {
    expect(swipeDirOf(dx, dy)).toBe(expected);
  });

  it('gives each direction an equal 45° sector, so a corner is no harder to hit than an axis', () => {
    // Just inside the boundary either side of "right" (±22.5°), then just past it.
    expect(swipeDirOf(100, 40)).toBe('right'); // ~22°
    expect(swipeDirOf(100, 50)).toBe('down-right'); // ~27°
    expect(swipeDirOf(100, -40)).toBe('right');
    expect(swipeDirOf(100, -50)).toBe('up-right');
  });

  it('wraps around the negative-x seam without falling out of the eight', () => {
    expect(swipeDirOf(-100, 1)).toBe('left');
    expect(swipeDirOf(-100, -1)).toBe('left');
  });
});

describe('the direction set', () => {
  it('offers eight directions, of which seven can be bound to a tag', () => {
    expect(SWIPE_DIRS).toHaveLength(8);
    expect(ASSIGNABLE_DIRS).toHaveLength(7);
  });

  it('reserves the bottom-right corner, so "none of these apply" is always sayable', () => {
    expect(NO_TAG_DIR).toBe('down-right');
    expect(ASSIGNABLE_DIRS).not.toContain(NO_TAG_DIR);
  });
});
