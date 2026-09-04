import {
  Component,
  EventEmitter,
  Input,
  Output,
  inject,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { Album } from '../lightroom.service';
import { PreferencesService } from '../preferences.service';
import { STEREO_ROLE_LABEL, StereoAlbumsService } from '../review/stereo-albums.service';
import { StereoRole } from '../detection/detectors/detection-types';

@Component({
  selector: 'app-album-manager',
  templateUrl: './album-manager.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './album-manager.scss',
})
export class AlbumManagerComponent {
  // Vacation tags are read and written straight on PreferencesService — the host no longer relays
  // them. The template binds `prefs.stereoEnabled()` to gate the Stereo control; the stereo mark
  // itself goes through StereoAlbumsService, which owns what a mark implies.
  readonly prefs = inject(PreferencesService);
  private readonly stereo = inject(StereoAlbumsService);

  @Input() albums: Album[] = [];
  @Output() back = new EventEmitter<void>();

  query = signal('');
  untaggedOnly = signal(false);

  filteredAlbums(): Album[] {
    const q = this.query().trim().toLowerCase();
    return this.albums.filter((album) => {
      if (q && !album.name.toLowerCase().includes(q)) return false;
      if (this.untaggedOnly() && this.isVacation(album.id)) return false;
      return true;
    });
  }

  isVacation(id: string): boolean {
    return this.prefs.vacationAlbumIds().includes(id);
  }

  /** The album's stereo pill text — "Stereo" when it carries no role yet. */
  stereoLabel(name: string): string {
    const role = this.stereo.role(name);
    return role ? STEREO_ROLE_LABEL[role].short : 'Stereo';
  }

  isStereo(name: string): boolean {
    return this.stereo.role(name) !== null;
  }

  stereoRole(name: string): StereoRole | null {
    return this.stereo.role(name);
  }

  /** The right album holding this left album's other eye, or null while it has none. */
  partner(name: string): string | null {
    return this.stereo.partner(name);
  }

  /** The left album this right one belongs to, or null while nothing claims it. */
  claimant(name: string): string | null {
    return this.stereo.claimant(name);
  }

  /** The albums a left one can be paired with: those marked as holding right eyes. */
  rightAlbums(): string[] {
    return this.stereo.rightAlbums();
  }

  onPartner(leftAlbum: string, event: Event): void {
    const chosen = (event.target as HTMLSelectElement).value;
    this.stereo.setPartner(leftAlbum, chosen || null);
  }

  toggleVacation(id: string): void {
    this.toggle(this.prefs.vacationAlbumIds, id);
  }

  /** Steps the album through the stereo roles: none → both eyes → left eyes → right eyes → none. */
  cycleStereo(name: string): void {
    this.stereo.cycle(name);
  }

  onQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  toggleUntagged(): void {
    this.untaggedOnly.update((v) => !v);
  }

  private toggle(ids: ReturnType<typeof signal<string[]>>, id: string): void {
    ids.update((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  }
}
