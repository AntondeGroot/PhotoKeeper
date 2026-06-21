import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  afterNextRender,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { SafeUrl } from '@angular/platform-browser';
import { Pano } from '../../photo';

@Component({
  selector: 'app-pano-card',
  templateUrl: './pano-card.html',
  styleUrl: './pano-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
})
export class PanoCardComponent {
  @Input() pano!: Pano;
  /** Frame-id → preview URL; frames without a cached preview fall back to a name placeholder. */
  @Input() imageUrls = new Map<string, SafeUrl>();
  @Output() swiped = new EventEmitter<'kept' | 'rejected' | 'toEdit' | 'maybe'>();
  /** "This isn't a pano, it's a burst" — relabel the group so it's reviewed as a burst instead. */
  @Output() reclassified = new EventEmitter<void>();

  private readonly destroyRef = inject(DestroyRef);
  private readonly strip = viewChild<ElementRef<HTMLElement>>('strip');

  /** Scroll position of the frame strip, 0–100, driving the slider (and updated by touch-scrolling). */
  protected readonly scrollPct = signal(0);
  /** Whether the frames overflow the viewport — only then is the scroll slider shown. */
  protected readonly overflowing = signal(false);

  protected get vertical(): boolean {
    return this.pano.orientation === 'vertical';
  }

  constructor() {
    // The frames overflow purely by count (fixed min size), so we can measure once they've rendered,
    // and re-measure on any size change (rotation, frame-count change) via a ResizeObserver.
    afterNextRender(() => {
      const el = this.strip()?.nativeElement;
      if (!el) return;
      this.sync();
      const observer = new ResizeObserver(() => this.sync());
      observer.observe(el);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  /** Touch/trackpad scroll of the strip → keep the slider in sync. */
  protected onScroll(): void {
    this.sync();
  }

  /** Slider dragged → scroll the strip to the matching fraction. */
  protected onSlider(event: Event): void {
    const el = this.strip()?.nativeElement;
    if (!el) return;
    const pct = Number((event.target as HTMLInputElement).value) / 100;
    if (this.vertical) el.scrollTop = pct * (el.scrollHeight - el.clientHeight);
    else el.scrollLeft = pct * (el.scrollWidth - el.clientWidth);
  }

  private sync(): void {
    const el = this.strip()?.nativeElement;
    if (!el) return;
    const max = this.vertical ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth;
    const pos = this.vertical ? el.scrollTop : el.scrollLeft;
    this.overflowing.set(max > 1);
    this.scrollPct.set(max > 0 ? (pos / max) * 100 : 0);
  }
}
