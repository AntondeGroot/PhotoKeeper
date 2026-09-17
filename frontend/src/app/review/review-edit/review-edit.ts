import {
  Component,
  EventEmitter,
  Input,
  OnInit,
  Output,
  ChangeDetectionStrategy,
  computed,
  inject,
  signal,
} from '@angular/core';
import { SafeUrl } from '@angular/platform-browser';
import { Photo } from '../../photo';
import { SceneComponent } from '../scene/scene';
import { KeeperAlbumsService } from '../../keeper-albums.service';
import { EditDetectionService } from '../edit-detection.service';
import { EditCandidatesService } from '../edit-candidates.service';
import { MergedPhoto } from '../merged-photo';
import { KeeperFilingService } from '../keeper-filing.service';
import { PreferencesService } from '../../preferences.service';
import { EditCheckComponent } from '../edit-check/edit-check';
import { KEEPER_EDIT_ALBUM, lightroomAlbumUrl, lightroomAssetUrl } from '../../keeper-albums';

@Component({
  selector: 'app-review-edit',
  templateUrl: './review-edit.html',
  imports: [EditCheckComponent, SceneComponent],
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
  /** A photo the user says is finished, so it can leave the queue and become printable. */
  @Output() promoted = new EventEmitter<string>();

  // Hosted here rather than in the app shell: the check is about this queue, and the shell is at its
  // line cap for good reason.
  protected readonly detection = inject(EditDetectionService);
  /** The queue's size and what is waiting behind it — see the note the template renders. */
  protected readonly filing = inject(KeeperFilingService);
  /** How large the album is allowed to get, so the note can say what it is up against. */
  protected readonly queueCap = inject(PreferencesService).editQueueCap;
  /** Photographs that have waited over a month — listed here whether or not today's batch holds them. */
  protected readonly mandatory = this.filing.mandatoryEdits;
  /**
   * Sets Lightroom has already merged, waiting to be confirmed.
   *
   * Here rather than only behind "Check for edits", because their frames have quietly left the list
   * of things to edit — and a photograph that vanishes from the queue with no word about where it
   * went is the app losing your work as far as anyone can tell from the outside.
   */
  protected readonly merges = inject(EditCandidatesService).merges;

  /** "Yes, that is it" — the merge becomes the photograph and its frames stand down. */
  protected settleMerge(merge: MergedPhoto): void {
    void this.detection.settleMerge(merge);
  }
  private readonly overdueIds = computed(
    () => new Set(this.mandatory().map((photo) => photo.assetId)),
  );

  /** Whether a row of today's batch is one of the photographs holding the album shut. */
  protected isMandatory(assetId: string): boolean {
    return this.overdueIds().has(assetId);
  }

  /** Into Lightroom, at the one photograph — the search route, as the per-item links use. */
  protected assetUrl(photo: { assetId: string; name: string }): string | null {
    const catalogId = this.catalogId;
    return catalogId ? lightroomAssetUrl(catalogId, photo.assetId, photo.name) : null;
  }

  /** Ask which of the queued photos have actually been worked on since they were sent. */
  checkForEdits(): void {
    void this.detection.check();
  }

  /** Skip the asking: list everything waiting, and let the user say which are finished. */
  pickEdits(): void {
    void this.detection.listQueue();
  }

  /**
   * The photo whose "Done editing" is awaiting confirmation, if any.
   *
   * Two steps, because the button sits in a list next to a link and a mis-tap would send the wrong
   * photo out of the queue. Confirming is a *different* control in a different place rather than the
   * same button again, so a stray double-tap cannot carry straight through it.
   */
  readonly confirming = signal<string | null>(null);

  askDone(photoId: string): void {
    this.confirming.set(photoId);
  }

  cancelDone(): void {
    this.confirming.set(null);
  }

  confirmDone(photoId: string): void {
    this.confirming.set(null);
    this.promoted.emit(photoId);
  }

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

  /** Deep-link to the asset in the Lightroom web app (opened in a new tab). */
  lightroomUrl(photo: Photo): string {
    const filename = photo.ext ? `${photo.name}.${photo.ext}` : photo.name;
    return lightroomAssetUrl(this.catalogId ?? '', photo.id, filename);
  }
}
