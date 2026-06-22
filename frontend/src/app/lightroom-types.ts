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
  };
}
