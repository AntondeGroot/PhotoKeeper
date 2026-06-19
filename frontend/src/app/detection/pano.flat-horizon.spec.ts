import { detectFixtureGroups } from './pano-fixtures.fixture';

// Real 640px renditions of a flat-heathland panorama: a horizontal sweep where the sky/horizon/grass
// layout is the same in every frame, which makes the *vertical* axis match spuriously. All seven
// frames are one horizontal pano.
describe('full pipeline on the flat-horizon panorama', () => {
  it('groups all seven frames as one horizontal pano (not vertical, not a burst)', () => {
    const { panos, bursts } = detectFixtureGroups('flat-horizon');

    expect(bursts).toEqual([]);
    expect(panos).toHaveLength(1);
    expect(panos[0].orientation).toBe('horizontal');
    expect(panos[0].memberIds).toEqual([
      'DSC_6444',
      'DSC_6445',
      'DSC_6446',
      'DSC_6447',
      'DSC_6448',
      'DSC_6449',
      'DSC_6450',
    ]);
  });
});
