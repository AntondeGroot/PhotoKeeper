import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decode as decodeJpeg } from 'jpeg-js';
import { PanoAsset, PanoOptions, clusterPanos } from './pano';
import { signatureFromRgba } from './phash';
import { DEFAULT_PANO_OPTIONS } from './detection-settings.service';

// Real 640px renditions of a bridge panorama: DSC_6427..6433 are the 7 portrait source frames of one
// left→right sweep; DSC_6433-Pano is the stitched landscape output (must NOT be grouped with them).
const FILES = [
  '01_DSC_6427',
  '02_DSC_6428',
  '03_DSC_6429',
  '04_DSC_6430',
  '05_DSC_6431',
  '06_DSC_6432',
  '07_DSC_6433',
  '08_DSC_6433-Pano',
];
const id = (file: string): string => file.replace(/^\d+_/, '');
const SOURCES = FILES.slice(0, 7).map(id);

const FIXTURE_DIR = join(process.cwd(), 'src/app/detection/__fixtures__/bridge-pano');

const signatures = new Map<string, Uint8Array>();
const aspects = new Map<string, number>();
for (const file of FILES) {
  const { data, width, height } = decodeJpeg(readFileSync(join(FIXTURE_DIR, `${file}.jpg`)), {
    useTArray: true,
  });
  signatures.set(id(file), signatureFromRgba(data, width, height));
  aspects.set(id(file), width / height);
}

// All eight a few seconds apart, so exclusion of the stitched output must come from the *content*
// match + aspect gate, not the time window. (Sources are portrait ~0.67; the stitched output is wide.)
const assets: PanoAsset[] = FILES.map((f, i) => ({
  id: id(f),
  taken: new Date(Date.parse('2026-05-01T10:00:00Z') + i * 2000).toISOString(),
  aspect: aspects.get(id(f)),
}));

// Production defaults; no whole-frame hashes are supplied, so the distinctness gate is inert here.
const opts: PanoOptions = DEFAULT_PANO_OPTIONS;

describe('clusterPanos on the real bridge panorama', () => {
  it('groups the seven source frames as one horizontal pano, excluding the stitched output', () => {
    const clusters = clusterPanos(assets, signatures, new Map(), opts);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].orientation).toBe('horizontal');
    expect(clusters[0].memberIds).toEqual(SOURCES);
  });
});
