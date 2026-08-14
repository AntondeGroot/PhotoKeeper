import { Injectable, inject } from '@angular/core';
import { CatalogScanService } from './catalog-scan.service';
import { AssetMetaStore } from '../../storage/review/asset-meta-store';
import { ReviewStore } from '../../storage/review/review-store';
import { REVIEW_BUFFER_TARGET } from '../../review/review-buffer-target';

/**
 * Target size of the "scanned but not yet reviewed" buffer the background detection pass maintains.
 *
 * Derived from the review queue's target rather than chosen separately: this scan is the *only*
 * source the review buffer draws from, so anything smaller is a ceiling the queue can never get
 * past. The two were once independent numbers — 100 here against 200 there — which left the queue
 * permanently half-full at best and its indicator permanently lit.
 *
 * The half again on top covers the difference in what the two count. This target counts *images*;
 * the review queue counts *units*, and a burst or a panorama is many images arriving as one unit.
 * A catalog with plenty of groups in it therefore yields well under one unit per image scanned.
 */
export const SCAN_BUFFER_TARGET = Math.round(REVIEW_BUFFER_TARGET * 1.5);

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
    return Math.max(0, SCAN_BUFFER_TARGET - unreviewed);
  }
}
