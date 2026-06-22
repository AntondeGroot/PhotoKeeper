import { detectFixtureGroups, detectFixturePanos } from './pano-fixtures.fixture';

// Real 640px renditions of flag-throwers: the flags whip around between frames but the camera/scene is
// fixed. Lots of structure, distinct-looking frames — but no real pan: the best seam is a weak ~18,
// far above the anchor threshold. It must be a burst, not a pano.
describe('full pipeline on a flag-thrower burst', () => {
  it('counts the three frames as a burst, not a pano', () => {
    expect(detectFixturePanos('burst-distinct')).toEqual([]); // pano detector rejects it (no anchor seam)

    const { panos, bursts } = detectFixtureGroups('burst-distinct');
    expect(panos).toEqual([]);
    expect(bursts).toEqual([{ memberIds: ['DSC_6307', 'DSC_6308', 'DSC_6309'] }]);
  });
});
