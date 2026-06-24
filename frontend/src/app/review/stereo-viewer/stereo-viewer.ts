import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { SafeUrl } from '@angular/platform-browser';
import { Stereo } from '../../photo';
import { PreviewCacheService } from '../preview-cache.service';

type View = 'parallel' | 'cross';

/**
 * Fullscreen side-by-side stereo viewer for free-viewing a pair without glasses. Shows the shared left
 * frame beside the selected baseline's right frame, ordered for **parallel** (L|R) or **cross** (R|L)
 * viewing, with an adjustable size and a 90° rotate for landscape free-viewing on a portrait phone.
 * Previews are read from the cache (the host warms the stereo unit's frames while it's being reviewed).
 */
@Component({
  selector: 'app-stereo-viewer',
  templateUrl: './stereo-viewer.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './stereo-viewer.scss',
})
export class StereoViewerComponent {
  private readonly previews = inject(PreviewCacheService);

  readonly stereo = input.required<Stereo>();
  /** The baseline to open on (the one the user tapped); user can switch once inside. */
  readonly baseline = input<string | null>(null);
  readonly closed = output<void>();

  readonly view = signal<View>('cross');
  readonly size = signal(180);
  readonly rotated = signal(false);
  private readonly userBase = signal<string | null>(null);

  /** The baseline currently shown — the user's pick, else the one opened on, else the first. */
  readonly baseSel = computed(
    () => this.userBase() ?? this.baseline() ?? this.stereo().baselines[0]?.key ?? null,
  );

  // L is the shared left frame; R is the selected baseline's first frame.
  private readonly rightFrame = computed(() => {
    const b = this.stereo().baselines.find((x) => x.key === this.baseSel());
    return b?.frames[0];
  });

  /** The two frames in viewing order — swapped for cross-eye so the eyes converge correctly. */
  readonly pair = computed(() => {
    const left = this.stereo().left[0];
    const right = this.rightFrame();
    const ordered =
      this.view() === 'parallel'
        ? [
            { tag: 'L', frame: left },
            { tag: 'R', frame: right },
          ]
        : [
            { tag: 'R', frame: right },
            { tag: 'L', frame: left },
          ];
    return ordered.filter(
      (p): p is { tag: string; frame: NonNullable<typeof p.frame> } => !!p.frame,
    );
  });

  imageUrl(id: string): SafeUrl | null {
    return this.previews.url(id);
  }

  selectBaseline(key: string): void {
    this.userBase.set(key);
  }
}
