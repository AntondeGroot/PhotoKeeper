import { Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { Stereo } from '../photo';

@Component({
  selector: 'app-stereo-card',
  templateUrl: './stereo-card.html',
  styleUrl: './stereo-card.scss',
  imports: [],
})
export class StereoCardComponent {
  @Input() stereo!: Stereo;
  @Output() swiped = new EventEmitter<'kept' | 'rejected' | 'toEdit'>();

  verdicts = signal<Record<string, 'keep' | 'edit' | 'reject'>>({});
  twoD = signal(false);

  allChosen = computed(() =>
    this.stereo.baselines.every((b) => this.verdicts()[b.key] !== undefined),
  );

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
