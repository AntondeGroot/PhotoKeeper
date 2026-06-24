import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { LightroomService } from '../../lightroom.service';
import { DetectionScanService } from './detection-scan.service';
import { AlbumManifestStore } from '../../storage/detection/album-manifest-store';
import { PreferencesService } from '../../preferences.service';

/** Default soft cap on images scanned per pass — the "keep ~100 ready" buffer the app tops up. */
const DEFAULT_IMAGE_BUDGET = 100;

/** Roll-up of one catalog scan pass. */
export interface CatalogScanSummary {
  albumsTotal: number;
  processed: number; // albums actually visited this pass (≤ albumsTotal when the budget is hit)
  scanned: number; // albums that advanced their cursor this pass
  skipped: number; // albums already fully scanned with no changes
  failed: number; // albums whose scan threw (best-effort: the pass continues)
  scannedImages: number; // images newly covered this pass (≈ the budget; a trailing group can overshoot)
  hashed: number; // assets hashed this pass
  groups: number; // burst/pano groups stored this pass
  completed: boolean; // false when the image budget stopped us before the last album
}

/**
 * Drives {@link DetectionScanService#scanAlbum} across the catalog — the background detection pass.
 * A *soft* per-pass image budget keeps each pass bounded (~100 images): albums are scanned in order,
 * each resuming from its cursor, until the budget runs out. The leftover albums (and the rest of a
 * partly-scanned one) wait for the next pass, which the app fires whenever the unreviewed buffer falls
 * back under the target. One straddling group can push a pass slightly over budget — that's the point.
 */
@Injectable({ providedIn: 'root' })
export class CatalogScanService {
  private readonly svc = inject(LightroomService);
  private readonly scan = inject(DetectionScanService);
  private readonly manifests = inject(AlbumManifestStore);
  private readonly prefs = inject(PreferencesService);

  /**
   * Forces a full re-detection: clears the per-album change-gate manifests so every album re-detects
   * from scratch (e.g. after the burst-window threshold changes), then scans the whole catalogue.
   */
  async rescanAllForcingRedetection(): Promise<CatalogScanSummary> {
    await this.manifests.clear();
    return this.scanAllAlbums();
  }

  async scanAllAlbums(imageBudget: number = DEFAULT_IMAGE_BUDGET): Promise<CatalogScanSummary> {
    const albums = await firstValueFrom(this.svc.getAlbums());
    const summary: CatalogScanSummary = {
      albumsTotal: albums.length,
      processed: 0,
      scanned: 0,
      skipped: 0,
      failed: 0,
      scannedImages: 0,
      hashed: 0,
      groups: 0,
      completed: true,
    };

    // Stereo detection runs only over albums the user marked as stereo (kept by name; see PreferencesService).
    const stereoAlbums = new Set(this.prefs.stereoAlbums());

    let remaining = imageBudget;
    for (const album of albums) {
      if (remaining <= 0) {
        summary.completed = false;
        break;
      }
      summary.processed++;
      try {
        const report = await this.scan.scanAlbum(album.id, remaining, stereoAlbums.has(album.name));
        summary.scannedImages += report.scanned;
        summary.hashed += report.hashed;
        summary.groups += report.groups;
        remaining -= report.scanned;
        if (report.scanned > 0) summary.scanned++;
        else summary.skipped++;
      } catch {
        // Best-effort: a failed album (e.g. a network blip) doesn't advance its cursor, so it
        // re-scans next pass. Keep going so one bad album can't stall the whole catalog.
        summary.failed++;
      }
    }
    return summary;
  }
}
