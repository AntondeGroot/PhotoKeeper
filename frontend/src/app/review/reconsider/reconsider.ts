import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { SafeUrl } from '@angular/platform-browser';
import { DecidedPhoto, ReconsiderService } from '../reconsider.service';
import { SwipeVerdict } from '../../photo';
import { VERDICT_STYLE } from '../../verdicts';

/** Keep first here, unlike the review card: this screen exists to rescue a photo, not to cull one. */
const OFFERED: readonly SwipeVerdict[] = ['kept', 'toEdit', 'maybe', 'rejected'];

/** What the app currently thinks, said plainly on the chosen photo. */
const STANDING: Record<string, string> = {
  kept: 'kept',
  rejected: 'to delete',
  toEdit: 'to edit',
  toPrint: 'done editing',
  maybe: 'a maybe',
  backlog: 'undecided',
};

/**
 * Changing a verdict you no longer agree with.
 *
 * <p>Undo covers the last twenty decisions of this session and stops there, because past that point
 * the photos have been filed into Lightroom and cannot be taken out again. This is the other case:
 * a photo has been sitting in KeeperDelete for a week and you find you like it. Nothing needs
 * un-writing — the verdict changes, the sweep files it where it now belongs, and the album it used
 * to be in turns up above as something to take it out of.
 *
 * <p>Opened per album rather than as one long list of everything ever decided, because that is how
 * the question arrives: you are looking at KeeperDelete when you notice.
 */
@Component({
  selector: 'app-reconsider',
  templateUrl: './reconsider.html',
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../tidy/tidy-card.scss',
})
export class ReconsiderComponent {
  private readonly service = inject(ReconsiderService);

  /** The albums worth looking through: the two the app files decisions into. */
  readonly albums = ['KeeperDelete', 'KeeperEdit'];
  readonly verdicts = OFFERED;
  readonly verdictStyle = VERDICT_STYLE;

  /** Which album is open, or null when the grid is closed. */
  readonly album = signal<string | null>(null);
  readonly photos = signal<DecidedPhoto[]>([]);
  /**
   * Which album is being opened, not merely that one is.
   *
   * A single flag made every button say "Opening…" at once, which reads as the app having heard the
   * wrong tap — the one thing a button pressed on a phone must never look like.
   */
  readonly opening = signal<string | null>(null);
  readonly failed = signal(false);
  /** The photo being re-judged, or null while browsing. */
  readonly chosen = signal<DecidedPhoto | null>(null);
  /** What the last change did, so the tap is answered even though the photo then leaves the grid. */
  readonly changed = signal<string | null>(null);

  thumbnail(assetId: string): SafeUrl | undefined {
    return this.service.thumbnails().get(assetId);
  }

  standing(status: string): string {
    return STANDING[status] ?? status;
  }

  async open(album: string): Promise<void> {
    if (this.opening()) return;
    this.opening.set(album);
    this.failed.set(false);
    this.changed.set(null);
    this.service.release();
    try {
      const photos = await this.service.photosIn(album);
      this.album.set(album);
      this.photos.set(photos);
      void this.service.loadThumbnails(photos.map((photo) => photo.assetId));
    } catch {
      this.failed.set(true);
      this.album.set(album);
      this.photos.set([]);
    } finally {
      this.opening.set(null);
    }
  }

  choose(photo: DecidedPhoto): void {
    this.chosen.set(photo);
  }

  /** Backs out of the chosen photo without changing anything. */
  cancel(): void {
    this.chosen.set(null);
  }

  close(): void {
    this.album.set(null);
    this.chosen.set(null);
    this.photos.set([]);
    this.service.release();
  }

  /**
   * Gives the chosen photo its new verdict and takes it out of the grid.
   *
   * Out of the grid because the grid is "what this album holds that the app decided", and the photo
   * has just stopped belonging to it — leaving it there, still showing its old standing, would
   * invite the same change twice.
   */
  async reverdict(status: SwipeVerdict): Promise<void> {
    const photo = this.chosen();
    if (!photo) return;
    await this.service.reverdict(photo.assetId, status);
    this.photos.update((list) => list.filter((one) => one.assetId !== photo.assetId));
    this.chosen.set(null);
    this.changed.set(`${photo.name} is now ${this.standing(status)}.`);
  }
}
