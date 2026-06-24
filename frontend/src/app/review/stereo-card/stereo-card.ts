import {
  Component,
  EventEmitter,
  Input,
  Output,
  computed,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { Stereo } from '../../photo';
import { StereoViewerComponent } from '../stereo-viewer/stereo-viewer';

@Component({
  selector: 'app-stereo-card',
  templateUrl: './stereo-card.html',
  styleUrl: './stereo-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [StereoViewerComponent],
})
export class StereoCardComponent {
  @Input() stereo!: Stereo;
  @Output() swiped = new EventEmitter<'kept' | 'rejected' | 'toEdit'>();

  verdicts = signal<Record<string, 'keep' | 'edit' | 'reject'>>({});
  twoD = signal(false);
  /** The baseline whose pair is open in the side-by-side viewer, or null when it's closed. */
  viewerBaseline = signal<string | null>(null);

  allChosen = computed(() => this.stereo.baselines.every((b) => b.key in this.verdicts()));

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
