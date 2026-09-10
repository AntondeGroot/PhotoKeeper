import {
  Component,
  Input,
  Output,
  EventEmitter,
  computed,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { SafeUrl } from '@angular/platform-browser';
import { CARD_SWIPE_COMMIT_PX, Photo, SwipeVerdict, swipeAim } from '../../photo';
import { SceneComponent } from '../scene/scene';

@Component({
  selector: 'app-photo-card',
  templateUrl: './photo-card.html',
  imports: [SceneComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './photo-card.scss',
})
export class PhotoCardComponent {
  @Input() photo!: Photo;
  @Input() imageUrl: SafeUrl | null = null;
  /** Frame-id → preview, so an edited photo can show the original beside it (same map the group cards get). */
  @Input() imageUrls = new Map<string, SafeUrl>();
  @Output() swiped = new EventEmitter<'kept' | 'rejected' | 'toEdit' | 'maybe'>();
  @Output() tapped = new EventEmitter<void>();
  /**
   * Open the original and the edit side by side. Same payload shape the burst card emits, so it
   * binds to the same handler and reuses the comparer you already know from bursts.
   */
  @Output() compare = new EventEmitter<{ ids: string[]; start: number }>();

  /** Enlarges one half of a before/after pair, opening on the frame that was tapped. */
  /**
   * Enlarge one half of an edited pair.
   *
   * Reached two ways, and only one of them may act. A pointer tap is settled in {@link onPointerUp},
   * which knows whether the gesture was a swipe; the click that follows it would open the photo on
   * top of the verdict just given, so it is swallowed. A keyboard press arrives here with no gesture
   * behind it, and is the reason this stays a button.
   */
  openFrame(index: number): void {
    if (this.handledAsGesture) {
      this.handledAsGesture = false;
      return;
    }
    this.emitCompare(index);
  }

  private emitCompare(index: number): void {
    if (this.photo.edit) {
      this.compare.emit({ ids: [this.photo.edit.originalId, this.photo.id], start: index });
    }
  }

  /** Set when a pointer tap has already been answered, so the click behind it does nothing. */
  private handledAsGesture = false;

  private startX = 0;
  private startY = 0;

  dragX = signal(0);
  dragY = signal(0);
  dragging = signal(false);

  dragTransform = computed(
    () => `translate(${this.dragX()}px, ${this.dragY()}px) rotate(${this.dragX() * 0.04}deg)`,
  );

  /** Where this drag is heading — the one verdict shown, and the one given on release. */
  readonly aim = computed(() => swipeAim(this.dragX(), this.dragY(), CARD_SWIPE_COMMIT_PX));

  /**
   * How strongly to show one verdict's label: nothing at all unless the drag is aimed at it.
   *
   * Only ever one label, however diagonal the drag. Fading each on its own axis lit two of them at
   * once and left it unclear which one letting go would give.
   */
  protected overlayOpacity(verdict: SwipeVerdict): number {
    const aim = this.aim();
    return aim.verdict === verdict ? aim.progress : 0;
  }

  onPointerDown(e: PointerEvent): void {
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.handledAsGesture = false;
    this.dragging.set(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  onPointerMove(e: PointerEvent): void {
    if (!this.dragging()) return;
    this.dragX.set(e.clientX - this.startX);
    this.dragY.set(e.clientY - this.startY);
  }

  onPointerUp(e?: PointerEvent): void {
    // A release that never began on the card is not a gesture on the card. Children that take their
    // own taps stop `pointerdown`, but `pointerup` still bubbles here — and with no movement behind
    // it, it read as a tap and opened the photo full screen on top of whatever the child was doing.
    if (!this.dragging()) return;

    // The same aim the labels are drawn from, so what was shown is what happens.
    const { verdict, progress } = this.aim();
    if (verdict && progress >= 1) {
      this.swiped.emit(verdict);
      this.handledAsGesture = true; // and not, a moment later, a click on the half it ended over
    } else if (Math.abs(this.dragX()) < 8 && Math.abs(this.dragY()) < 8) {
      // A tap. On an edited pair it means the half under the finger; on anything else, the photo.
      if (this.photo.edit && e) {
        this.emitCompare(this.halfAt(e));
        this.handledAsGesture = true;
      } else {
        this.tapped.emit();
      }
    }

    this.dragging.set(false);
    this.dragX.set(0);
    this.dragY.set(0);
  }

  /** Which half of the pair a tap landed on: before is the left one, after the right. */
  private halfAt(e: PointerEvent): number {
    const card = (e.currentTarget ?? e.target) as HTMLElement | null;
    const box = card?.getBoundingClientRect();
    if (!box) return 0;
    return e.clientX - box.left < box.width / 2 ? 0 : 1;
  }
}
