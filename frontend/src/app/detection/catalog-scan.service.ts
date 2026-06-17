import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { LightroomService } from '../lightroom.service';
import { DetectionScanService } from './detection-scan.service';

/** Default cap on assets hashed per pass, so a first-time backfill spreads over several runs. */
const DEFAULT_MAX_HASHES_PER_PASS = 500;

/** Roll-up of one catalog scan pass. */
export interface CatalogScanSummary {
  albumsTotal: number;
  processed: number; // albums actually visited this pass (≤ albumsTotal when the budget is hit)
  scanned: number; // albums that had changes and were re-detected
  skipped: number; // albums the change-gate found unchanged
  failed: number; // albums whose scan threw (best-effort: the pass continues)
  hashed: number; // assets hashed this pass (the budgeted quantity)
  groups: number; // burst groups stored this pass
  completed: boolean; // false when the budget stopped us before the last album
}

/**
 * Drives {@link DetectionScanService#scanAlbum} across every album in the catalog — the background
 * detection pass. A per-pass hash budget keeps a large first-time backfill gentle on Adobe's rate
 * limit; since each album records its manifest only on success, a budget-truncated or partially
 * failed pass simply resumes the unfinished albums next run.
 */
@Injectable({ providedIn: 'root' })
export class CatalogScanService {
  private readonly svc = inject(LightroomService);
  private readonly scan = inject(DetectionScanService);

  async scanAllAlbums(
    maxHashesPerPass: number = DEFAULT_MAX_HASHES_PER_PASS,
  ): Promise<CatalogScanSummary> {
    const albums = await firstValueFrom(this.svc.getAlbums());
    const summary: CatalogScanSummary = {
      albumsTotal: albums.length,
      processed: 0,
      scanned: 0,
      skipped: 0,
      failed: 0,
      hashed: 0,
      groups: 0,
      completed: true,
    };

    for (const album of albums) {
      // Budget is checked between albums (never mid-album), so a manifest is only ever recorded for a
      // fully-scanned album. One album may push us slightly over budget; that's fine.
      if (summary.hashed >= maxHashesPerPass) {
        summary.completed = false;
        break;
      }
      summary.processed++;
      try {
        const report = await this.scan.scanAlbum(album.id);
        summary.hashed += report.hashed;
        summary.groups += report.groups;
        if (report.skipped) summary.skipped++;
        else summary.scanned++;
      } catch {
        // Best-effort: a failed album (e.g. a network blip) doesn't record its manifest, so it
        // re-scans next pass. Keep going so one bad album can't stall the whole catalog.
        summary.failed++;
      }
    }
    return summary;
  }
}
