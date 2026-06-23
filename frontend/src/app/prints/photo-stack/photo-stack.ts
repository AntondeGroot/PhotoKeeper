import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { SafeUrl } from '@angular/platform-browser';
import { Photo, isDevicePhoto } from '../../photo';
import { SceneComponent } from '../../review/scene/scene';
import { PreviewCacheService } from '../../review/preview-cache.service';

const FRAME = 62; // print frame width (px)
const STEP = 36; // horizontal step per print — the frame minus its overlap

/**
 * An overlapping pile of prints, like a handful of physical photos. Responsive: a ResizeObserver
 * measures the available width and shows exactly as many prints as fit (no overflow, no "+N"), each
 * with a cream paper border, drop shadow, and a deterministic tilt. Warms only the prints it shows.
 */
@Component({
  selector: 'app-photo-stack',
  templateUrl: './photo-stack.html',
  imports: [SceneComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './photo-stack.scss',
})
export class PhotoStackComponent implements OnDestroy {
  private readonly host = inject(ElementRef);
  private readonly previews = inject(PreviewCacheService);

  readonly photos = input.required<Photo[]>();

  private readonly width = signal(0);
  private readonly observer = new ResizeObserver((entries) => {
    this.width.set(entries[0].contentRect.width);
  });

  /** As many prints as fit the measured width (overlap baked in); all of them until first measured. */
  readonly shown = computed<Photo[]>(() => {
    const w = this.width();
    const fit = w > 0 ? Math.max(1, Math.floor((w - FRAME - 6) / STEP) + 1) : this.photos().length;
    return this.photos().slice(0, Math.min(fit, this.photos().length));
  });

  constructor() {
    this.observer.observe(this.host.nativeElement as Element);
    // Warm the previews of the prints actually shown — the host's prefetch effect steps aside here.
    effect(() => {
      for (const photo of this.shown()) {
        if (!isDevicePhoto(photo)) void this.previews.ensure(photo.id);
      }
    });
  }

  ngOnDestroy(): void {
    this.observer.disconnect();
  }

  imageUrl(id: string): SafeUrl | null {
    return this.previews.url(id);
  }

  /** Deterministic tilt + vertical jitter for the print at index i, so the pile looks hand-stacked. */
  transform(i: number): string {
    const dy = this.jitter(i + 7.3, 6);
    const rot = this.jitter(i + 1, 7);
    return `translateY(${dy}px) rotate(${rot}deg)`;
  }

  // Deterministic pseudo-random in [-range, range] from a seed, so each print's tilt is stable.
  private jitter(seed: number, range: number): number {
    const x = Math.sin(seed * 12.9898) * 43758.5453;
    return (x - Math.floor(x) - 0.5) * 2 * range;
  }
}
