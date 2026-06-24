import { PhotoAsset } from './lightroom-types';

/** Camera identity pulled from an asset — the body that shot the frame. */
export interface CameraIdentity {
  make?: string;
  model?: string;
  serial?: string;
}

/**
 * Resolves an asset's camera identity. Prefers the normalized `payload.camera` block we persist and
 * restore (see AssetMeta), and otherwise walks Lightroom's raw EXIF — make/model live under the xmp.tiff
 * namespace and the body serial under xmp.aux, but the exact nesting isn't guaranteed, so we match keys
 * by name rather than a fixed path (first match per field wins). This is the signal twin-DSLR stereo
 * pairing keys on: two bodies → two distinct serials → which frame is the left vs right eye.
 */
export function cameraIdentity(asset: PhotoAsset): CameraIdentity {
  const normalized = asset.payload?.camera;
  if (normalized && (normalized.serial ?? normalized.make ?? normalized.model)) {
    return { ...normalized };
  }

  const out: CameraIdentity = {};
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
  visit(asset.payload);
  return out;
}

/** The camera body serial — the twin-rig left/right key. Undefined when the camera wrote none. */
export function cameraSerial(asset: PhotoAsset): string | undefined {
  return cameraIdentity(asset).serial;
}

/**
 * True when the asset carries any camera identity — i.e. it's a real capture, not a derived/combined
 * export (a merged stereograph or anaglyph the user produced carries no camera EXIF). Stereo detection
 * gates on this so derived outputs don't get mistaken for one eye of a pair.
 */
export function isCaptureFrame(asset: PhotoAsset): boolean {
  const { make, model, serial } = cameraIdentity(asset);
  return Boolean(make ?? model ?? serial);
}
