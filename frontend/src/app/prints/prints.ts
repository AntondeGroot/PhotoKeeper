import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { SafeUrl } from '@angular/platform-browser';
import { AlbumGroup } from '../photo';
import { SceneComponent } from '../review/scene/scene';

@Component({
  selector: 'app-prints',
  templateUrl: './prints.html',
  imports: [SceneComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './prints.scss',
})
export class PrintsComponent {
  /** Albums whose keepers are edited and ready to export/print. */
  @Input() toPrintByAlbum: AlbumGroup[] = [];
  /** Albums whose prints have arrived and been placed — empty until the fulfilment flow exists. */
  @Input() doneByAlbum: AlbumGroup[] = [];
  /** Frame-id → preview URL for the thumbnails (a generated scene is shown when absent). */
  @Input() imageUrls = new Map<string, SafeUrl>();

  /** Total photos across a lane's album groups (drives the count + empty state). */
  total(groups: AlbumGroup[]): number {
    return groups.reduce((n, g) => n + g.photos.length, 0);
  }
}
