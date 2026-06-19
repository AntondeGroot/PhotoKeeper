import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decode as decodeJpeg } from 'jpeg-js';
import { PanoAsset, PanoOptions, clusterPanos } from './pano';
import { signatureFromRgba } from './phash';
import { DEFAULT_PANO_OPTIONS } from './detection-settings.service';

// Real 640px renditions of a flat-heathland panorama: a horizontal sweep where the sky/horizon/grass
// layout is the same in every frame, which makes the *vertical* axis match spuriously. All seven
// frames are one horizontal pano.
const FILES = [
  '01_DSC_6444',
  '02_DSC_6445',
  '03_DSC_6446',
  '04_DSC_6447',
  '05_DSC_6448',
  '06_DSC_6449',
  '07_DSC_6450',
];
const id = (file: string): string => file.replace(/^\d+_/, '');
const SOURCES = FILES.map(id);

const FIXTURE_DIR = join(process.cwd(), 'src/app/detection/__fixtures__/flat-horizon');

const signatures = new Map<string, Uint8Array>();
const aspects = new Map<string, number>();
for (const file of FILES) {
  const { data, width, height } = decodeJpeg(readFileSync(join(FIXTURE_DIR, `${file}.jpg`)), {
    useTArray: true,
  });
  signatures.set(id(file), signatureFromRgba(data, width, height));
  aspects.set(id(file), width / height);
}

const assets: PanoAsset[] = FILES.map((f, i) => ({
  id: id(f),
  taken: new Date(Date.parse('2026-05-01T10:00:00Z') + i * 2000).toISOString(),
  aspect: aspects.get(id(f)),
}));

const opts: PanoOptions = DEFAULT_PANO_OPTIONS;

describe('clusterPanos on the flat-horizon panorama', () => {
  it('groups all seven frames as one horizontal pano (not vertical)', () => {
    const clusters = clusterPanos(assets, signatures, new Map(), opts);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].orientation).toBe('horizontal');
    expect(clusters[0].memberIds).toEqual(SOURCES);
  });
});
