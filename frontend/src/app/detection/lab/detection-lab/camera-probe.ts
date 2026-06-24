// Throwaway diagnostic (stereo-pairing): settles whether a twin-DSLR rig's two bodies are separable by
// EXIF, which is the precondition for a per-album left/right default. Delete this file once decided.

import { PhotoAsset } from '../../../lightroom-types';

interface CameraFields {
  make?: string;
  model?: string;
  serial?: string;
}

/**
 * Recursively pulls camera identity out of an asset's untyped payload. Lightroom nests EXIF under
 * xmp.tiff (Make/Model) and xmp.aux (SerialNumber), so we walk the whole tree and match keys by name
 * rather than assuming a path. First match per field wins.
 */
function findCameraFields(payload: unknown): CameraFields {
  const out: CameraFields = {};
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const k = key.toLowerCase();
      if (typeof value === 'string') {
        if (!out.serial && k.includes('serial')) out.serial = value;
        else if (!out.make && k === 'make') out.make = value;
        else if (!out.model && k === 'model') out.model = value;
      } else {
        visit(value);
      }
    }
  };
  visit(payload);
  return out;
}

/**
 * Builds a human-readable report of the camera identity across an album's assets, tallying the distinct
 * make/model/serial signatures so two bodies show up as two rows. Also logs the first asset's full
 * payload to the console, so the real field paths can be read if the names differ from what we expect.
 */
export function buildCameraProbeReport(assets: readonly PhotoAsset[]): string {
  // eslint-disable-next-line no-console
  if (assets[0]) console.log('[camera-probe] first asset payload:', assets[0].payload);

  const tally = new Map<string, number>();
  const samples: string[] = [];
  for (const a of assets) {
    const { make, model, serial } = findCameraFields(a.payload);
    const sig = `${make ?? '?'} / ${model ?? '?'} · SN=${serial ?? '—'}`;
    tally.set(sig, (tally.get(sig) ?? 0) + 1);
    if (samples.length < 8) samples.push(`${a.payload?.importSource?.fileName ?? a.id}: ${sig}`);
  }

  return [
    `${assets.length} image assets`,
    '',
    'Distinct camera signatures (count × make / model · serial):',
    ...[...tally.entries()].map(([sig, n]) => `  ${n}×  ${sig}`),
    '',
    'First frames:',
    ...samples.map((s) => `  ${s}`),
    '',
    '(Full first-asset payload logged to the browser console.)',
  ].join('\n');
}
