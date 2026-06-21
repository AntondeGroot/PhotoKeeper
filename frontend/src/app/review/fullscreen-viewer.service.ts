import { Injectable, inject, signal } from '@angular/core';
import { SafeUrl } from '@angular/platform-browser';
import { ReviewFeedService } from './review-feed.service';
import { PreviewCacheService } from './preview-cache.service';
import { ReviewDecisionsService } from './review-decisions.service';
import { ViewerImage } from './fullscreen-viewer/fullscreen-viewer';

/**
 * The full-screen viewer overlay: its open/closed state and the two ways it opens — a single review
 * photo (with verdict buttons) or a burst's frames as an A/B compare — plus the verdict-from-overlay
 * flow that decides the current photo and advances to the next, closing when the run is done. Reads the
 * live deck via {@link ReviewFeedService} so a verdict re-derives against the *new* current photo, and
 * applies verdicts through {@link ReviewDecisionsService} so the overlay and the cards share one path.
 */
@Injectable({ providedIn: 'root' })
export class FullscreenViewerService {
  private readonly feed = inject(ReviewFeedService);
  private readonly previews = inject(PreviewCacheService);
  private readonly decisions = inject(ReviewDecisionsService);

  /** Images shown in the full-screen viewer, or null when it's closed. */
  readonly images = signal<ViewerImage[] | null>(null);
  /** Single-photo (review) mode shows verdict buttons; burst compare shows A/B switching. */
  readonly reviewMode = signal(false);
  /** Which frame the viewer opens on (the tapped one, for burst compare). */
  readonly startIndex = signal(0);

  /** Open the current single photo full screen (true orientation) with verdict buttons to review it. */
  openPhoto(): void {
    const current = this.feed.current();
    if (current?.kind !== 'photo') return;
    this.reviewMode.set(true);
    this.startIndex.set(0);
    this.images.set([{ label: current.name, url: this.currentPhotoUrl() }]);
  }

  /**
   * Open the given burst frames (the current duel pair) full screen, labelled A/B, starting on the
   * tapped frame. The caller supplies the frame-id → preview URL map it already holds for the cards.
   */
  openBurstCompare(event: { ids: string[]; start: number }, urls: Map<string, SafeUrl>): void {
    const images = event.ids.map((id, i) => ({
      label: String.fromCharCode(65 + i),
      url: urls.get(id),
    }));
    if (images.length === 0) return;
    this.reviewMode.set(false);
    this.startIndex.set(event.start);
    this.images.set(images);
  }

  // A verdict from the viewer's buttons: decide the current photo, then show the next one full screen
  // (or close if the next isn't a single photo, or the session is done).
  verdict(verdict: 'kept' | 'rejected' | 'toEdit' | 'maybe'): void {
    this.decisions.decide(verdict);
    const current = this.feed.current();
    if (!this.sessionDone() && current?.kind === 'photo') {
      this.images.set([{ label: current.name, url: this.currentPhotoUrl() }]);
    } else {
      this.close();
    }
  }

  close(): void {
    this.images.set(null);
  }

  // The current single photo's preview URL (null when the current unit isn't a single photo).
  private currentPhotoUrl(): SafeUrl | null {
    const current = this.feed.current();
    return current?.kind === 'photo' ? this.previews.url(current.id) : null;
  }

  // Every queued unit has a verdict — the run is done, so the viewer should close rather than advance.
  private sessionDone(): boolean {
    const photos = this.feed.photos();
    return photos.filter((p) => p.status !== 'backlog').length === photos.length;
  }
}
