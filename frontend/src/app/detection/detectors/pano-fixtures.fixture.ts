// Shared loader for the real-photo pano fixtures under `__fixtures__/<folder>` (640px JPEGs). Decodes
// each with jpeg-js, builds the matcher's signature + aspect, and assembles `PanoAsset`s on a synthetic
// 2-second cadence. Lives in a `.fixture.ts` (excluded from the app build) because it pulls in node:fs
// and the jpeg-js dev-dependency — neither belongs in the shipped bundle.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { decode as decodeJpeg } from 'jpeg-js';
import { BurstCluster, BurstOptions, DetectAsset, clusterBursts } from './burst';
import { PanoAsset, PanoCluster, PanoOptions, clusterPanos, overlapMatch } from './pano';
import { HASH_HEIGHT, HASH_WIDTH, dhash, hammingDistance, signatureFromRgba } from './phash';
import { DEFAULT_BURST_OPTIONS, DEFAULT_PANO_OPTIONS } from '../scan/detection-settings.service';

const FIXTURES_ROOT = join(process.cwd(), 'src/app/detection/detectors/__fixtures__');

export interface PanoFixture {
  ids: string[]; // frame ids (filename without the NN_ prefix / extension), in capture order
  assets: PanoAsset[];
  signatures: Map<string, Uint8Array>;
  hashes: Map<string, string>; // whole-frame dHash, so fixtures exercise the distinctness gate too
}

/** Box-downscales an RGBA buffer to a 9×8 grayscale grid and dHashes it (≈ the production whole hash). */
function wholeHashFromRgba(data: Uint8Array, width: number, height: number): string {
  const gray: number[] = [];
  for (let oy = 0; oy < HASH_HEIGHT; oy++) {
    const y0 = Math.floor((oy * height) / HASH_HEIGHT);
    const y1 = Math.max(y0 + 1, Math.floor(((oy + 1) * height) / HASH_HEIGHT));
    for (let ox = 0; ox < HASH_WIDTH; ox++) {
      const x0 = Math.floor((ox * width) / HASH_WIDTH);
      const x1 = Math.max(x0 + 1, Math.floor(((ox + 1) * width) / HASH_WIDTH));
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 4;
          sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          count++;
        }
      }
      gray.push(sum / count);
    }
  }
  return dhash(gray);
}

/** Loads every `NN_*.jpg` in a fixture folder (sorted) into signatures + aspect-bearing `PanoAsset`s. */
export function loadPanoFixture(folder: string): PanoFixture {
  const dir = join(FIXTURES_ROOT, folder);
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.jpg'))
    .sort((a, b) => a.localeCompare(b));

  const ids: string[] = [];
  const signatures = new Map<string, Uint8Array>();
  const hashes = new Map<string, string>();
  const assets: PanoAsset[] = [];
  files.forEach((file, i) => {
    const id = file.replace(/^\d+_/, '').replace(/\.jpg$/, '');
    const { data, width, height } = decodeJpeg(readFileSync(join(dir, file)), { useTArray: true });
    ids.push(id);
    signatures.set(id, signatureFromRgba(data, width, height));
    hashes.set(id, wholeHashFromRgba(data, width, height));
    assets.push({
      id,
      taken: new Date(Date.parse('2026-05-01T10:00:00Z') + i * 2000).toISOString(),
      aspect: width / height,
    });
  });
  return { ids, assets, signatures, hashes };
}

/** Runs the production pano detector over a fixture folder (with whole-frame hashes, like production). */
export function detectFixturePanos(
  folder: string,
  opts: PanoOptions = DEFAULT_PANO_OPTIONS,
): PanoCluster[] {
  const { assets, signatures, hashes } = loadPanoFixture(folder);
  return clusterPanos(assets, signatures, hashes, opts);
}

/** Runs the burst detector over a fixture folder. */
export function detectFixtureBursts(
  folder: string,
  opts: BurstOptions = DEFAULT_BURST_OPTIONS,
): BurstCluster[] {
  const { assets, hashes } = loadPanoFixture(folder);
  const detectAssets: DetectAsset[] = assets.map((a) => ({ id: a.id, taken: a.taken }));
  return clusterBursts(detectAssets, hashes, opts);
}

/**
 * Resolves a fixture the way the scan does: bursts win, panos that share any frame with a burst are
 * dropped. So near-duplicate frames never become a spurious pano; the trade is that a real pan whose
 * frames sit within burst distance (the tower) falls back to a burst.
 */
export function detectFixtureGroups(folder: string): {
  panos: PanoCluster[];
  bursts: BurstCluster[];
} {
  const bursts = detectFixtureBursts(folder);
  const burstMembers = new Set(bursts.flatMap((b) => b.memberIds));
  const panos = detectFixturePanos(folder).filter(
    (p) => !p.memberIds.some((id) => burstMembers.has(id)),
  );
  return { panos, bursts };
}

/** Per-adjacent-pair h/v slide scores + overlaps + whole-frame distance — for diagnosing a mis-detect. */
export function fixtureSeamReport(
  folder: string,
  opts: PanoOptions = DEFAULT_PANO_OPTIONS,
): string {
  const { ids, signatures, hashes } = loadPanoFixture(folder);
  return ids
    .slice(0, -1)
    .map((id, i) => {
      const a = signatures.get(id) as Uint8Array;
      const b = signatures.get(ids[i + 1]) as Uint8Array;
      const h = overlapMatch(a, b, 'horizontal', opts);
      const v = overlapMatch(a, b, 'vertical', opts);
      const whole = hammingDistance(hashes.get(id) as string, hashes.get(ids[i + 1]) as string);
      const fmt = (m: { score: number; overlap: number }): string =>
        `${m.score.toFixed(1)} (ov ${Math.round(m.overlap * 100)}%)`;
      return `${id} -> ${ids[i + 1]}: h ${fmt(h)} / v ${fmt(v)} · whole ${whole}`;
    })
    .join('\n');
}
