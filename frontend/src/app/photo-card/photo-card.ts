import {
  Component,
  Input,
  Output,
  EventEmitter,
  computed,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { Photo } from '../photo';

@Component({
  selector: 'app-photo-card',
  templateUrl: './photo-card.html',
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './photo-card.scss',
})
export class PhotoCardComponent {
  @Input() photo!: Photo;
  @Output() swiped = new EventEmitter<'kept' | 'rejected' | 'toEdit' | 'maybe'>();
  private startX = 0;
  private startY = 0;

  dragX = signal(0);
  dragY = signal(0);
  dragging = signal(false);

  dragTransform = computed(
    () => `translate(${this.dragX()}px, ${this.dragY()}px) rotate(${this.dragX() * 0.04}deg)`,
  );

  onPointerDown(e: PointerEvent): void {
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.dragging.set(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  onPointerMove(e: PointerEvent): void {
    if (!this.dragging()) return;
    this.dragX.set(e.clientX - this.startX);
    this.dragY.set(e.clientY - this.startY);
  }

  onPointerUp(): void {
    if (this.dragX() > 100) {
      this.swiped.emit('kept');
    } else if (this.dragX() < -100) {
      this.swiped.emit('rejected');
    } else if (this.dragY() > 100) {
      this.swiped.emit('maybe');
    } else if (this.dragY() < -100) {
      this.swiped.emit('toEdit');
    }

    this.dragging.set(false);
    this.dragX.set(0);
    this.dragY.set(0);
  }
}
