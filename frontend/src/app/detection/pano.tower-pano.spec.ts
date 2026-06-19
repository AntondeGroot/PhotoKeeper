import { detectFixturePanos } from './pano-fixtures.fixture';

// Real 640px renditions of a vertical pan DOWN a tower (landscape frames). DSC_6137 is mostly flat blue
// sky with the spire, so its whole-frame hash sits close to the next frame's (~19) — it must still join
// the pano, not be dropped by the distinctness gate.
describe('clusterPanos on the tower panorama', () => {
  it('groups all three frames as one vertical pano', () => {
    const clusters = detectFixturePanos('tower-pano');

    expect(clusters).toHaveLength(1);
    expect(clusters[0].orientation).toBe('vertical');
    expect(clusters[0].memberIds).toEqual(['DSC_6137', 'DSC_6138', 'DSC_6139']);
  });
});
