import { Injectable, inject } from '@angular/core';
import { CatalogScanService } from './catalog-scan.service';
import { AssetMetaStore } from '../storage/review/asset-meta-store';
import { ReviewStore } from '../storage/review/review-store';

/** Target size of the "scanned but not yet reviewed" buffer the background detection pass maintains. */
const SCAN_BUFFER_TARGET = 100;

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
