import {
  Component,
  EventEmitter,
  HostListener,
  Input,
  Output,
  computed,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { SafeUrl } from '@angular/platform-browser';

export interface ViewerImage {
  label: string;
  url: SafeUrl | null | undefined;
}

export type ReviewVerdict = 'kept' | 'rejected' | 'toEdit' | 'maybe';

/**
 * Full-screen image overlay. Fits the image to the viewport with `contain`, so it shows at its true
 * orientation (landscape stays landscape) instead of the cropped portrait card. With more than one
 * image it switches **in place** — tap a label or swipe left/right — so flipping A↔B at the same spot
 * makes the differences obvious. Created/destroyed by the parent, so it always opens on the first.
 */
@Component({
  selector: 'app-fullscreen-viewer',
  templateUrl: './fullscreen-viewer.html',
  styleUrl: './fullscreen-viewer.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
})
export class FullscreenViewerComponent {
  // Signal-backed so swapping in the next photo (review mode) actually re-renders. Opens on the frame
  // that was clicked (startIndex), order-independent of when the two inputs are set.
  private readonly imagesSig = signal<ViewerImage[]>([]);
  private pendingStart = 0;
  @Input() set images(value: ViewerImage[]) {
    this.imagesSig.set(value);
    this.index.set(this.pendingStart);
  }
  get images(): ViewerImage[] {
    return this.imagesSig();
  }

  @Input() set startIndex(i: number) {
    this.pendingStart = i;
    this.index.set(i);
  }

  // Review mode shows the verdict buttons + swipe flags (single review photo, not a burst compare).
  @Input() reviewMode = false;
  @Output() closed = new EventEmitter<void>();
  @Output() verdict = new EventEmitter<ReviewVerdict>();

  index = signal(0);
  dragX = signal(0);
  dragY = signal(0);
  private readonly dragging = signal(false);

  readonly current = computed<ViewerImage | undefined>(() => this.imagesSig()[this.index()]);
  readonly multi = computed(() => this.imagesSig().length > 1);
  // Image follows the drag in review mode, so the directional flag underneath is revealed.
  readonly dragTransform = computed(() =>
    this.reviewMode ? `translate(${this.dragX()}px, ${this.dragY()}px)` : 'none',
  );

  private startX = 0;
  private startY = 0;

  show(i: number): void {
    if (i >= 0 && i < this.imagesSig().length) this.index.set(i);
  }

  /** Step to the next/previous image, wrapping around the ends ("overflow"). */
  private step(delta: number): void {
    const n = this.imagesSig().length;
    if (n === 0) return;
    this.index.set((this.index() + delta + n) % n);
  }

  next(): void {
    this.step(1);
  }

  prev(): void {
    this.step(-1);
  }

  // Arrow keys page through the images (wrapping), so you can flip A↔B at the same spot by holding a
  // key. Only when there's more than one image and we're not in single-photo review mode.
  @HostListener('document:keydown.arrowright')
  onArrowRight(): void {
    if (this.multi() && !this.reviewMode) this.next();
  }

  @HostListener('document:keydown.arrowleft')
  onArrowLeft(): void {
    if (this.multi() && !this.reviewMode) this.prev();
  }

  chooseVerdict(v: ReviewVerdict): void {
    this.verdict.emit(v);
  }

  onPointerDown(event: PointerEvent): void {
    this.startX = event.clientX;
    this.startY = event.clientY;
    this.dragging.set(true);
    (event.currentTarget as HTMLElement | null)?.setPointerCapture(event.pointerId);
  }

  onPointerMove(event: PointerEvent): void {
    if (!this.dragging()) return;
    this.dragX.set(event.clientX - this.startX);
    this.dragY.set(event.clientY - this.startY);
  }

  onPointerUp(): void {
    const dx = this.dragX();
    const dy = this.dragY();
    this.dragging.set(false);
    this.dragX.set(0);
    this.dragY.set(0);

    if (this.reviewMode) {
      // Review: a clean tap closes; a long directional swipe gives a verdict; partial swipes snap back.
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) this.close();
      else this.swipeVerdict(dx, dy);
    } else if (Math.abs(dx) > 40 && this.imagesSig().length > 0) {
      const n = this.imagesSig().length;
      this.index.set((this.index() + (dx < 0 ? 1 : -1) + n) % n); // compare: clear swipe → switch
    } else {
      this.close(); // compare: any other gesture (incl. a tap with slight movement) closes
    }
  }

  private swipeVerdict(dx: number, dy: number): void {
    if (Math.abs(dx) >= Math.abs(dy)) {
      if (dx > 80) this.verdict.emit('kept');
      else if (dx < -80) this.verdict.emit('rejected');
    } else if (dy > 80) {
      this.verdict.emit('maybe');
    } else if (dy < -80) {
      this.verdict.emit('toEdit');
    }
  }

  @HostListener('document:keydown.escape')
  close(): void {
    this.closed.emit();
  }
}
