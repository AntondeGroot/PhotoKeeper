import { Injectable, computed, signal } from '@angular/core';
import { BurstOptions } from './burst';
import { PanoOptions } from './pano';

const STORAGE_KEY = 'detection-burst-options';

/**
 * Provisional pano defaults: a 60s pan window, edges within Hamming 12 count as overlapping, and at
 * least 3 frames make a panorama. Not yet user-tunable — tune via the detection lab / corpus later.
 */
export const DEFAULT_PANO_OPTIONS: PanoOptions = {
  windowMs: 60_000,
  maxEdgeHamming: 12,
  minSize: 3,
};

/**
 * Defaults chosen from detection-lab tuning (see docs/track-b-detection.md): a 60s window catches
 * slower re-shoots of the same subject, and Hamming 24 keeps clearly-different shots apart while
 * tolerating real burst variation. The wider window does hash more during active shooting sessions —
 * an accepted trade-off. Users can still re-tune via the burst-window setting.
 */
export const DEFAULT_BURST_OPTIONS: BurstOptions = { windowMs: 60_000, maxHamming: 24, minSize: 2 };

/** A burst must contain at least two frames. */
const MIN_BURST_SIZE = 2;

/**
 * User-tunable burst-detection thresholds, persisted on-device. The background scan reads
 * {@link burstOptions} so changes take effect on the next scan. Surfaced in the settings UI for
 * fine-tuning; sensible defaults mean it works untouched.
 */
@Injectable({ providedIn: 'root' })
export class DetectionSettingsService {
  private readonly windowMs = signal(DEFAULT_BURST_OPTIONS.windowMs);
  private readonly maxHamming = signal(DEFAULT_BURST_OPTIONS.maxHamming);
  private readonly minSize = signal(DEFAULT_BURST_OPTIONS.minSize);

  /** The current thresholds, ready to hand to `clusterBursts`. */
  readonly burstOptions = computed<BurstOptions>(() => ({
    windowMs: this.windowMs(),
    maxHamming: this.maxHamming(),
    minSize: this.minSize(),
  }));

  /** Pano thresholds for `clusterPanos`. Fixed defaults for now (no UI tuning yet). */
  readonly panoOptions = computed<PanoOptions>(() => DEFAULT_PANO_OPTIONS);

  constructor() {
    this.load();
  }

  /** Updates the given thresholds (others untouched) and persists. `minSize` is floored at 2. */
  setBurstOptions(opts: Partial<BurstOptions>): void {
    if (opts.windowMs !== undefined) this.windowMs.set(opts.windowMs);
    if (opts.maxHamming !== undefined) this.maxHamming.set(opts.maxHamming);
    if (opts.minSize !== undefined) this.minSize.set(Math.max(MIN_BURST_SIZE, opts.minSize));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.burstOptions()));
  }

  private load(): void {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Partial<BurstOptions>;
      if (typeof parsed.windowMs === 'number') this.windowMs.set(parsed.windowMs);
      if (typeof parsed.maxHamming === 'number') this.maxHamming.set(parsed.maxHamming);
      if (typeof parsed.minSize === 'number')
        this.minSize.set(Math.max(MIN_BURST_SIZE, parsed.minSize));
    } catch {
      // Malformed stored value → keep the defaults.
    }
  }
}
