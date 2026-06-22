import { detectFixtureGroups } from './pano-fixtures.fixture';

// Real 640px renditions of a near-still burst (a marching band, subjects shifting between frames while
// the camera barely moves). The horizontal axis matches at the overlap cap — no real pan. The pipeline
// must label them a burst, not a pano.
describe('full pipeline on a near-still burst', () => {
  it('labels the three near-still frames a burst, not a pano', () => {
    const { panos, bursts } = detectFixtureGroups('burst-not-pano');

    expect(panos).toEqual([]);
    expect(bursts).toHaveLength(1);
    expect(bursts[0].memberIds).toEqual(['DSC_6223', 'DSC_6224', 'DSC_6225']);
  });
});
