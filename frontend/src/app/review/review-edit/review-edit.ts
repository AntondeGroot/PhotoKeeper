import { Component, EventEmitter, Input, Output, ChangeDetectionStrategy } from '@angular/core';
import { SafeUrl } from '@angular/platform-browser';
import { Photo } from '../../photo';
import { SceneComponent } from '../scene/scene';

@Component({
  selector: 'app-review-edit',
  templateUrl: './review-edit.html',
  imports: [SceneComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './review-edit.scss',
})
export class ReviewEditComponent {
  @Input() queue: Photo[] = [];
  /** Frame-id → preview URL for the queued photos (a generated scene is shown when absent). */
  @Input() imageUrls = new Map<string, SafeUrl>();
  /** Lightroom catalog id, for the per-photo "Open in Lightroom" deep-link. */
  @Input() catalogId: string | null = null;
  @Input() editDone: boolean = false;
  /** Retained so a "mark edited → print" affordance can be re-added; the Edit list is open-only for now. */
  @Output() promoted = new EventEmitter<string>();

  /** Deep-link to the asset in the Lightroom web app (opened in a new tab). The web app routes to a
   *  single asset via *search* — the `/search/assets/<id>` path plus a `q` query matching the filename
   *  — rather than a plain `/assets/<id>` path (which 404s the asset and never opens). */
  lightroomUrl(photo: Photo): string {
    const filename = photo.ext ? `${photo.name}.${photo.ext}` : photo.name;
    const base = `https://lightroom.adobe.com/libraries/${this.catalogId}/search/assets/${photo.id}`;
    return `${base}?q=${encodeURIComponent(filename)}`;
  }
}
