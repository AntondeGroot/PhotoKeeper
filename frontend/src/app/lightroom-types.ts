/**
 * The Lightroom API asset shape, as returned by the catalog feed. Pure domain (a plain data contract,
 * no Angular) so on-device selection/detection logic can consume it without depending on the service
 * that fetches it.
 */
export interface PhotoAsset {
  id: string;
  subtype: string;
  updated?: string; // Lightroom revision stamp; drives the detection change-gate (album-manifest-store)
  album?: string;
  payload?: {
    captureDate?: string;
    userCreated?: string;
    importSource?: { fileName?: string };
    // Decimal GPS from the asset's location block — present on geotagged/drone frames, absent otherwise.
    // Drives stereo baseline decomposition: horizontal displacement between a set's frames = the baseline.
    location?: { latitude?: number; longitude?: number; altitude?: number };
    // Normalized camera identity we persist + restore (NOT Lightroom's shape — raw EXIF nests under xmp).
    // Read via camera-metadata.ts; the body serial keys twin-DSLR stereo left/right pairing.
    camera?: { make?: string; model?: string; serial?: string };
  };
}
