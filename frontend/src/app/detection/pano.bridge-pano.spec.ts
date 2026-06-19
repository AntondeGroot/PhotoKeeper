import { detectFixturePanos } from './pano-fixtures.fixture';

// Real 640px renditions of a bridge panorama: DSC_6427..6433 are the 7 portrait source frames of one
// left→right sweep; DSC_6433-Pano is the stitched landscape output (must NOT be grouped with them).
describe('clusterPanos on the real bridge panorama', () => {
  it('groups the seven source frames as one horizontal pano, excluding the stitched output', () => {
    const clusters = detectFixturePanos('bridge-pano');

    expect(clusters).toHaveLength(1);
    expect(clusters[0].orientation).toBe('horizontal');
    expect(clusters[0].memberIds).toEqual([
      'DSC_6427',
      'DSC_6428',
      'DSC_6429',
      'DSC_6430',
      'DSC_6431',
      'DSC_6432',
      'DSC_6433',
    ]);
  });
});
