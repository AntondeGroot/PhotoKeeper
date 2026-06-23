import { ChangeDetectionStrategy, Component, Input, inject } from '@angular/core';
import { PreferencesService } from '../../preferences.service';

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

  /** The current review photo's album name (stereo is keyed by album name). */
  @Input() album: string | null = null;

  isStereo(): boolean {
    return !!this.album && this.prefs.stereoAlbums().includes(this.album);
  }

  toggleStereo(): void {
    const album = this.album;
    if (!album) return;
    this.prefs.stereoAlbums.update((names) =>
      names.includes(album) ? names.filter((n) => n !== album) : [...names, album],
    );
  }
}
