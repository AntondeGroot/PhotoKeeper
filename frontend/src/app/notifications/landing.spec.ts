import { isLandingSpot, landingFor } from './landing';

describe('landingFor', () => {
  it('opens the Edit step for a nudge about the edit queue', () => {
    expect(landingFor('edit', false)).toEqual({ tab: 'review', mode: 'edit' });
  });

  it('opens the Tag step when tagging is switched on', () => {
    expect(landingFor('tag', true)).toEqual({ tab: 'review', mode: 'tag' });
  });

  it('falls back to Sort for a tag nudge once tagging has been switched off', () => {
    // The reminder was scheduled while Tag was a step; by the time it is tapped it may not be one.
    expect(landingFor('tag', false)).toEqual({ tab: 'review', mode: 'sort' });
  });

  it('opens the Prints tab, which has no review step of its own', () => {
    expect(landingFor('prints', true)).toEqual({ tab: 'prints', mode: null });
  });

  it('opens Sort for a plain nudge', () => {
    expect(landingFor('sort', true)).toEqual({ tab: 'review', mode: 'sort' });
  });
});

describe('isLandingSpot', () => {
  it('accepts the steps this build knows', () => {
    expect(['sort', 'edit', 'tag', 'prints'].every(isLandingSpot)).toBe(true);
  });

  it('rejects anything else, including a step from a future build', () => {
    // The OS held that alarm for hours; the app that scheduled it may not be the app reading it.
    expect(isLandingSpot('keepsakes')).toBe(false);
    expect(isLandingSpot(undefined)).toBe(false);
    expect(isLandingSpot(2)).toBe(false);
  });
});
