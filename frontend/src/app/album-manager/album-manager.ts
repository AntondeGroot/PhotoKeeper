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

@Component({
  selector: 'app-album-manager',
  templateUrl: './album-manager.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './album-manager.scss',
})
export class AlbumManagerComponent {
  // Album tags (vacation / stereo) are read and written straight on PreferencesService — the host no
  // longer relays them. The template binds `prefs.stereoEnabled()` to gate the Stereo control.
  readonly prefs = inject(PreferencesService);

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

  isStereo(name: string): boolean {
    return this.prefs.stereoAlbums().includes(name);
  }

  toggleVacation(id: string): void {
    this.toggle(this.prefs.vacationAlbumIds, id);
  }

  toggleStereo(name: string): void {
    this.toggle(this.prefs.stereoAlbums, name);
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
