import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  computed,
  inject,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { SafeUrl } from '@angular/platform-browser';
import { Stereo } from '../../photo';
import { PreviewCacheService } from '../preview-cache.service';
import { StereoViewerComponent } from '../stereo-viewer/stereo-viewer';

@Component({
  selector: 'app-stereo-card',
  templateUrl: './stereo-card.html',
  styleUrl: './stereo-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [StereoViewerComponent],
})
export class StereoCardComponent implements OnChanges {
  private readonly previews = inject(PreviewCacheService);

  @Input() stereo!: Stereo;
  @Output() swiped = new EventEmitter<'kept' | 'rejected' | 'toEdit'>();
  /** Twin-rig only: the user flipped which body is the left eye. Carries the album + new left serial so
   * the host can persist the choice per album. */
  @Output() swapEyes = new EventEmitter<{ albumName: string | null; leftSerial: string }>();

  verdicts = signal<Record<string, 'keep' | 'edit' | 'reject'>>({});
  twoD = signal(false);
  /** The baseline whose pair is open in the side-by-side viewer, or null when it's closed. */
  viewerBaseline = signal<string | null>(null);
  /** Local left/right flip for immediate feedback; the persisted per-album choice rides swapEyes. */
  private readonly swapped = signal(false);

  /** A twin-DSLR set carries two body serials → offer the swap; drone/cha-cha sets don't. */
  get canSwap(): boolean {
    return !!this.stereo.rig;
  }

  /** A summary that reads sensibly for a single pair as well as a multi-baseline (shared-left) set. */
  get meta(): string {
    const s = this.stereo;
    if (s.baselines.length <= 1) return 'stereo pair'; // one L/R pair — nothing "shared" across baselines
    const n = s.left.length;
    return `${n} shared left frame${n === 1 ? '' : 's'} · ${s.baselines.length} baselines`;
  }

  /** The set as shown, with the eyes exchanged when swapped (twin-rig has a single right baseline). */
  get displayStereo(): Stereo {
    const right = this.stereo.baselines[0];
    if (!this.swapped() || !this.stereo.rig || !right) return this.stereo;
    return {
      ...this.stereo,
      left: right.frames,
      baselines: [{ ...right, frames: this.stereo.left }],
      rig: { leftSerial: this.stereo.rig.rightSerial, rightSerial: this.stereo.rig.leftSerial },
    };
  }

  allChosen = computed(() => this.stereo.baselines.every((b) => b.key in this.verdicts()));

  /**
   * A new `stereo` (e.g. re-hydrated after a per-album swap persisted) already carries the corrected
   * L/R, so drop the local flip — otherwise it would double-swap on top of the album-level change.
   */
  ngOnChanges(): void {
    this.swapped.set(false);
  }

  /** Flip the left/right eye, and tell the host which serial is now the left one (to persist per album). */
  toggleSwap(): void {
    const rig = this.stereo.rig;
    if (!rig) return;
    const next = !this.swapped();
    this.swapped.set(next);
    this.swapEyes.emit({
      albumName: this.stereo.album,
      leftSerial: next ? rig.rightSerial : rig.leftSerial,
    });
  }

  /** The cached preview for a frame, or null until it's warmed (then the name shows alone). */
  imageUrl(id: string): SafeUrl | null {
    return this.previews.url(id);
  }

  setVerdict(key: string, verdict: 'keep' | 'edit' | 'reject'): void {
    this.verdicts.update((v) => ({ ...v, [key]: verdict }));
  }

  confirm(): void {
    const vals = Object.values(this.verdicts());
    let overall: 'kept' | 'toEdit' | 'rejected';
    if (this.twoD() || vals.includes('edit')) {
      overall = 'toEdit';
    } else if (vals.includes('keep')) {
      overall = 'kept';
    } else {
      overall = 'rejected';
    }
    this.swiped.emit(overall);
  }
}
