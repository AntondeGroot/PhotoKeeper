import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { SafeUrl } from '@angular/platform-browser';
import { AlbumGroup, Photo, isDevicePhoto } from '../../photo';
import { SceneComponent } from '../../review/scene/scene';
import { PreviewCacheService } from '../../review/preview-cache.service';
import { printsIn } from '../prints.types';

/** Photos revealed at a time. Each one costs a 2048px preview, so an album arrives in pages. */
const PAGE = 24;

/** How close to the end of the list counts as "at the end" (px). */
const REVEAL_MARGIN = 80;

/**
 * Choosing an album's prints: every photo in it prints, and tapping one sets it aside as "keep it,
 * don't print it". Tapping again puts it back.
 *
 * The album gets the whole tab rather than an panel inside its card. Which photos are worth paper is
 * a judgement about the set — the ones next to each other, the near-repeats, the one that carries the
 * day — and a book's worth of them cannot be weighed through a letterbox.
 */
@Component({
  selector: 'app-print-picker',
  templateUrl: './print-picker.html',
  imports: [SceneComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './print-picker.scss',
})
export class PrintPickerComponent {
  private readonly previews = inject(PreviewCacheService);

  readonly album = input.required<AlbumGroup>();

  /** The photo whose print/save choice was flipped. */
  readonly toggled = output<Photo>();

  /** Finished choosing — back to the album list. */
  readonly closed = output<void>();

  private readonly revealed = signal(PAGE);

  readonly photos = computed(() => this.album().photos);
  readonly chosen = computed(() => printsIn(this.album()).length);
  readonly shown = computed(() => this.photos().slice(0, this.revealed()));
  readonly hasMore = computed(() => this.photos().length > this.revealed());

  constructor() {
    // Warm only what has been revealed: warming a whole album would fetch hundreds of previews to
    // show two dozen.
    effect(() => {
      for (const photo of this.shown()) {
        if (!isDevicePhoto(photo)) void this.previews.ensure(photo.id);
      }
    });
  }

  imageUrl(id: string): SafeUrl | null {
    return this.previews.url(id);
  }

  /** Reveals the next page once the grid is scrolled to its end. */
  revealMore(grid: HTMLElement): void {
    if (!this.hasMore()) return;
    const atEnd = grid.scrollTop + grid.clientHeight >= grid.scrollHeight - REVEAL_MARGIN;
    if (atEnd) this.revealed.update((n) => n + PAGE);
  }
}
