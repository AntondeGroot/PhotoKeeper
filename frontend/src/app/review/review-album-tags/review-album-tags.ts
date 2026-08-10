import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { PreferencesService } from '../../preferences.service';
import { CatalogScanService } from '../../detection/scan/catalog-scan.service';
import { ReviewDecisionsService } from '../review-decisions.service';

/**
 * In-review album tags shown above the sort card. Currently the "mark as stereo" control: stereo is an
 * album-level property, so this toggles the *current photo's album* in PreferencesService — the same
 * key the album manager uses, so a mark made here shows there too. Only rendered when the Stereo tools
 * feature is on and the photo has an album.
 */
@Component({
  selector: 'app-review-album-tags',
  templateUrl: './review-album-tags.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './review-album-tags.scss',
})
export class ReviewAlbumTagsComponent {
  readonly prefs = inject(PreferencesService);
  private readonly catalogScan = inject(CatalogScanService);
  private readonly decisions = inject(ReviewDecisionsService);

  /** The current review photo's album name (stereo is keyed by album name). */
  readonly album = input<string | null>(null);

  isStereo(): boolean {
    const album = this.album();
    return !!album && this.prefs.stereoAlbums().includes(album);
  }

  toggleStereo(): void {
    const album = this.album();
    if (!album) return;
    const nowStereo = !this.isStereo();
    this.prefs.stereoAlbums.update((names) =>
      names.includes(album) ? names.filter((n) => n !== album) : [...names, album],
    );
    // The tag changes which detectors run over the album but none of its assets, so the change gate
    // would skip it forever. Dropping its manifest is what makes the next scan pass look again.
    void this.catalogScan.invalidateAlbumByName(album);
    // Take the album's remaining frames out of today's deck: they are halves of pairs now, and the
    // re-scan will bring them back linked. Untagging does not put them back — there is nothing to
    // put back, and the next selection will pick them up as singles again.
    if (nowStereo) this.decisions.withdrawAlbum(album);
  }
}
