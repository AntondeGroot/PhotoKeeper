import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Output,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { Pano, PanoFrame } from '../../../photo';
import { PanoCandidate, toggleFrame } from '../../pano-frames';
import { PanoFramesService } from '../../pano-frames.service';
import { PreviewCacheService } from '../../preview-cache.service';

/**
 * "Photos are missing" — the shots around a panorama, for saying which of them belong to it.
 *
 * Shown as the same scrolling strip as the pano itself, so the sweep reads the same way it does on
 * the card, with the frames the pano already has ringed in gold. Tapping a photo rings it (or takes
 * the ring off), and Done hands back the whole set: the picker states what the pano *is*, rather
 * than accumulating an "added" list, because that is the question someone is actually answering.
 */
@Component({
  selector: 'app-pano-frame-picker',
  templateUrl: './frame-picker.html',
  styleUrl: './frame-picker.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
})
export class PanoFramePickerComponent {
  readonly pano = input.required<Pano>();

  /** The confirmed frames, in capture order. Empty means nothing was changed. */
  @Output() confirmed = new EventEmitter<PanoFrame[]>();
  @Output() cancelled = new EventEmitter<void>();

  private readonly frames = inject(PanoFramesService);
  private readonly previews = inject(PreviewCacheService);

  /** Everything on offer: the pano's own frames plus their neighbours, in capture order. */
  protected readonly candidates = signal<PanoCandidate[]>([]);
  /** Which of them belong to the pano right now — the gold rings. */
  protected readonly selected = signal<readonly string[]>([]);
  /** False until the neighbourhood has been read, so the strip doesn't flash an empty state. */
  protected readonly loaded = signal(false);

  /** Whether detection split this sweep, so the strip can say what the dashed frames are. */
  protected readonly hasSibling = computed(() =>
    this.candidates().some((candidate) => candidate.inOtherGroup),
  );

  /** Whether anything has actually changed, so Done can say nothing rather than re-saving a no-op. */
  protected readonly changed = computed(() => {
    const before = this.pano().frames.map((frame) => frame.id);
    const after = this.selected();
    return before.length !== after.length || before.some((id, i) => id !== after[i]);
  });

  constructor() {
    effect(() => {
      const pano = this.pano();
      this.selected.set(pano.frames.map((frame) => frame.id));
      void this.load(pano);
    });
  }

  protected url(id: string) {
    return this.previews.url(id);
  }

  protected isSelected(id: string): boolean {
    return this.selected().includes(id);
  }

  protected toggle(id: string): void {
    this.selected.set(toggleFrame(this.selected(), id, this.candidates()));
  }

  /** Done — hand back the frames as the pano should now have them, in capture order. */
  protected done(): void {
    const chosen = new Set(this.selected());
    this.confirmed.emit(
      this.candidates()
        .filter((candidate) => chosen.has(candidate.id))
        .map(({ id, name, ext }) => ({ id, name, ext })),
    );
  }

  private async load(pano: Pano): Promise<void> {
    this.loaded.set(false);
    const candidates = await this.frames.candidatesFor(pano);
    this.candidates.set(candidates);
    this.loaded.set(true);
    // Warm the neighbours' previews: they are not part of the review deck, so nothing else fetches
    // them, and a strip of file names is not something anyone can pick a panorama frame out of.
    for (const candidate of candidates) void this.previews.ensure(candidate.id);
  }
}
