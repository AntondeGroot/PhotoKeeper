/**
 * The Lightroom API asset shape, as returned by the catalog feed. Pure domain (a plain data contract,
 * no Angular) so on-device selection/detection logic can consume it without depending on the service
 * that fetches it.
 */
export interface PhotoAsset {
  id: string;
  /**
   * 'image' for a photograph; **'deleted_image'** for the tombstone Lightroom leaves in its place.
   *
   * Deleting a photo does not take it out of its albums. Lightroom replaces the asset with a new one
   * of this subtype — a new id, carrying {@link original} and a `purgeDate` thirty days out — and
   * leaves *that* in every album the photo was in. So an album listing mixes photographs with the
   * headstones of photographs, and the two must never be counted as the same thing.
   */
  subtype: string;
  /** On a 'deleted_image', the asset it replaced: the id everything else in this app knew it by. */
  original?: { id?: string };
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
