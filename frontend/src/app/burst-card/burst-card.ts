import {
  Component,
  EventEmitter,
  Input,
  Output,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { Burst } from '../photo';

@Component({
  selector: 'app-burst-card',
  templateUrl: './burst-card.html',
  styleUrl: './burst-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
})
export class BurstCardComponent {
  @Input() burst!: Burst;
  @Output() picked = new EventEmitter<string>();
  @Output() rejectedAll = new EventEmitter<void>();

  zoomed = signal(false);

  get survivors() {
    return this.burst.photos.filter((p) => !p.blur);
  }

  get excluded() {
    return this.burst.photos.filter((p) => p.blur);
  }

  toggleZoom(): void {
    this.zoomed.update((z) => !z);
  }
}
