import {
  Component,
  EventEmitter,
  Input,
  OnInit,
  Output,
  ChangeDetectionStrategy,
  inject,
} from '@angular/core';
import { SafeUrl } from '@angular/platform-browser';
import { Photo } from '../../photo';
import { SceneComponent } from '../scene/scene';
import { KeeperAlbumsService } from '../../keeper-albums.service';
import { KEEPER_EDIT_ALBUM, lightroomAlbumUrl } from '../../keeper-albums';

@Component({
  selector: 'app-review-edit',
  templateUrl: './review-edit.html',
  imports: [SceneComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './review-edit.scss',
})
export class ReviewEditComponent implements OnInit {
  @Input() queue: Photo[] = [];
  /** Frame-id → preview URL for the queued photos (a generated scene is shown when absent). */
  @Input() imageUrls = new Map<string, SafeUrl>();
  /** Lightroom catalog id, for the per-photo "Open in Lightroom" deep-link. */
  @Input() catalogId: string | null = null;
  @Input() editDone: boolean = false;
  /** Retained so a "mark edited → print" affordance can be re-added; the Edit list is open-only for now. */
  @Output() promoted = new EventEmitter<string>();

  private readonly albums = inject(KeeperAlbumsService);

  /** The album name the button offers, so the label and the destination cannot drift apart. */
  protected readonly editAlbumName = KEEPER_EDIT_ALBUM;

  ngOnInit(): void {
    // Cheap: the answer is read once per session and shared with the setup notice.
    void this.albums.ensure();
  }

  /**
   * Where the "open the whole album" button goes, or null when there is nowhere to send anyone —
   * the catalog has no KeeperEdit album (or has not been read yet), or there is no catalog id.
   *
   * A method rather than a computed because `catalogId` arrives as an input: change detection
   * re-reads this when the input changes, and the signal it reads keeps it live when the album
   * check answers.
   */
  editAlbumUrl(): string | null {
    const albumId = this.albums.editAlbumId();
    return albumId && this.catalogId ? lightroomAlbumUrl(this.catalogId, albumId) : null;
  }

  /** Deep-link to the asset in the Lightroom web app (opened in a new tab). The web app routes to a
   *  single asset via *search* — the `/search/assets/<id>` path plus a `q` query matching the filename
   *  — rather than a plain `/assets/<id>` path (which 404s the asset and never opens). */
  lightroomUrl(photo: Photo): string {
    const filename = photo.ext ? `${photo.name}.${photo.ext}` : photo.name;
    const base = `https://lightroom.adobe.com/libraries/${this.catalogId}/search/assets/${photo.id}`;
    return `${base}?q=${encodeURIComponent(filename)}`;
  }
}
