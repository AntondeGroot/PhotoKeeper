import { Injectable, inject } from '@angular/core';
import { CatalogScanService } from './catalog-scan.service';
import { AssetMetaStore } from '../../storage/review/asset-meta-store';
import { ReviewStore } from '../../storage/review/review-store';
import { ReviewBufferService } from '../../review/review-buffer.service';
import { REVIEW_BUFFER_TARGET } from '../../review/review-buffer-target';

/**
 * Ceiling on how far ahead the scan will work, however badly the catalog groups.
 *
 * The target below is measured from the catalog rather than assumed, and a measurement can be wrong
 * — early on, or in an album that is one long burst. This is what stops a bad estimate turning into
 * unbounded hashing on a phone.
 */
const MAX_SCAN_TARGET = REVIEW_BUFFER_TARGET * 4;

/** Debounce before a review-triggered refill, so a flurry of swipes coalesces into one pass. */
const SCAN_REFILL_DEBOUNCE_MS = 4000;

/**
 * Keeps the on-device detection buffer topped up: each pass scans only the *deficit* (target minus the
 * images already scanned but not yet reviewed), so a full buffer is free and a depleted one pulls in
 * just what's missing. Best-effort and off the UI thread. The `isAuthenticated` accessor is read at
 * *run* time so a disconnect during the debounce window cancels the scan.
 */
@Injectable({ providedIn: 'root' })
export class BackgroundScanService {
  private readonly catalogScan = inject(CatalogScanService);
  private readonly meta = inject(AssetMetaStore);
  private readonly reviewStore = inject(ReviewStore);
  private readonly buffer = inject(ReviewBufferService);

  private timer: ReturnType<typeof setTimeout> | null = null;

  /** Runs one refill pass now (no-op if not authenticated). */
  async run(isAuthenticated: () => boolean): Promise<void> {
    if (!isAuthenticated()) return; // no Lightroom session → nothing to scan
    try {
      const budget = await this.refillBudget();
      if (budget > 0) await this.catalogScan.scanAllAlbums(budget);
    } catch {
      // Background work; a failure just means the next session falls back to the server sample.
    }
  }

  /** Schedules a debounced refill after review activity, so any decision keeps the buffer replenished. */
  scheduleRefill(isAuthenticated: () => boolean): void {
    if (!isAuthenticated()) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(isAuthenticated), SCAN_REFILL_DEBOUNCE_MS);
  }

  /** Clears any pending refill timer (call on teardown). */
  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  // The deficit to scan: target minus images already scanned but not yet reviewed. Group members
  // reviewed only at the unit level (panos/stereos) count as un-reviewed here, so the buffer can read a
  // touch high — harmless, it just scans less.
  private async refillBudget(): Promise<number> {
    const [metaById, verdicts] = await Promise.all([
      this.meta.getAll(),
      this.reviewStore.getVerdicts(),
    ]);
    let unreviewed = 0;
    for (const id of metaById.keys()) {
      if (!verdicts.has(id)) unreviewed++;
    }
    return Math.max(0, this.scanTarget(unreviewed) - unreviewed);
  }

  /**
   * How many unreviewed images to keep on the device, measured from what this catalog actually
   * yields rather than assumed.
   *
   * This scan counts *images* while the review queue counts *units*, and a burst, a panorama, or a
   * Lightroom edit sitting beside its original all arrive as one unit made of several images. The
   * ratio between the two is a property of somebody's photos, not a constant: a guessed multiplier
   * left a catalog that groups heavily stuck at 45% of a queue it could never fill.
   *
   * So it is divided out of the two numbers already known — unreviewed images against units the
   * queue managed to build from them — and converges in a pass or two: scanning more raises both
   * counts, the ratio holds, and the target settles where the queue comes out full.
   */
  private scanTarget(unreviewed: number): number {
    const units = this.buffer.available();
    // Before the queue has built anything there is nothing to measure, so assume the plain case of
    // one image per unit; the next pass measures for real.
    const imagesPerUnit = units > 0 ? unreviewed / units : 1;
    const wanted = Math.round(REVIEW_BUFFER_TARGET * imagesPerUnit);
    return Math.min(MAX_SCAN_TARGET, Math.max(REVIEW_BUFFER_TARGET, wanted));
  }
}
