import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { PreferencesService } from '../../preferences.service';
import { STEREO_ROLE_LABEL, StereoAlbumsService } from '../stereo-albums.service';

/**
 * In-review album tags shown above the sort card. Currently the stereo mark: a stereo role belongs to
 * the album, so this marks the *current photo's album* — the same key the album manager writes, so a
 * mark made here shows there too. Only rendered when the Stereo tools feature is on and the photo has
 * an album.
 */
@Component({
  selector: 'app-review-album-tags',
  templateUrl: './review-album-tags.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './review-album-tags.scss',
})
export class ReviewAlbumTagsComponent {
  readonly prefs = inject(PreferencesService);
  private readonly stereo = inject(StereoAlbumsService);

  /** The current review photo's album name (a stereo role is keyed by album name). */
  readonly album = input<string | null>(null);

  isStereo(): boolean {
    return this.stereo.role(this.album()) !== null;
  }

  /** What the album is marked as, or the invitation to mark it when it carries no role. */
  label(): string {
    const role = this.stereo.role(this.album());
    return role ? STEREO_ROLE_LABEL[role].long : 'Mark as stereo';
  }

  /** Steps the album through the stereo roles: none → both eyes → left eyes → right eyes → none. */
  cycleStereo(): void {
    const album = this.album();
    if (album) this.stereo.cycle(album);
  }
}
