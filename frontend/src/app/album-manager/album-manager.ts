import {
  Component,
  EventEmitter,
  Input,
  Output,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { Album } from '../lightroom.service';

@Component({
  selector: 'app-album-manager',
  templateUrl: './album-manager.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './album-manager.scss',
})
export class AlbumManagerComponent {
  @Input() albums: Album[] = [];
  @Input() vacationAlbumIds: string[] = [];
  @Output() toggleVacation = new EventEmitter<string>();
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
    return this.vacationAlbumIds.includes(id);
  }

  onQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  toggleUntagged(): void {
    this.untaggedOnly.update((v) => !v);
  }
}
