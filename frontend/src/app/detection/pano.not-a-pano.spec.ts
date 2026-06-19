import { detectFixtureGroups, detectFixturePanos } from './pano-fixtures.fixture';

// Real 640px renditions of a near-still crowd sequence (a festival; subjects shifting, camera roughly
// fixed). Its best vertical alignments sit at ~80% overlap — near-zero displacement, no real pan — and
// its strongest real-displacement seam is a weak ~14. Without a confident anchor seam it must NOT be a
// pano (it should fall back to bursts / singles).
describe('full pipeline on a near-still crowd sequence', () => {
  it('does not produce a pano (no confident seam to anchor a pan)', () => {
    // Robust: rejected by the pano detector itself, not only by burst precedence.
    expect(detectFixturePanos('not-a-pano')).toEqual([]);
    expect(detectFixtureGroups('not-a-pano').panos).toEqual([]);
  });
});
