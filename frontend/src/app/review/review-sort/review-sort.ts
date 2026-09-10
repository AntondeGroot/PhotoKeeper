import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  computed,
  inject,
  input,
} from '@angular/core';
import { SafeUrl } from '@angular/platform-browser';
import { PanoFrame, Photo, SwipeVerdict } from '../../photo';
import { VERDICT_STYLE } from '../../verdicts';
import { PhotoCardComponent } from '../photo-card/photo-card';
import { PanoFramePickerComponent } from '../pano-card/frame-picker/frame-picker';
import { AssembledGroup, NavigationService } from '../../navigation.service';

/**
 * The three the card offers at a tap; Maybe is a swipe only, for want of room. Edit and Keep are
 * the two you reach for most, so they are drawn as the larger pair.
 */
const QUICK_VERDICTS: readonly { verdict: SwipeVerdict; primary: boolean }[] = [
  { verdict: 'rejected', primary: false },
  { verdict: 'toEdit', primary: true },
  { verdict: 'kept', primary: true },
];

@Component({
  selector: 'app-review-sort',
  templateUrl: './review-sort.html',
  imports: [PhotoCardComponent, PanoFramePickerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './review-sort.scss',
})
export class ReviewSortComponent {
  /**
   * Signal input, so {@link seed} below can be a computed with a stable identity.
   *
   * It used to be a plain input and the seed a method, which handed the picker a *new array on every
   * change-detection pass*: its own effect then re-ran, reloading the neighbourhood and resetting the
   * rings — so the strip flickered and a tap was undone before it could land.
   */
  readonly photo = input.required<Photo>();
  @Input() imageUrl: SafeUrl | null = null;
  @Input() imageUrls = new Map<string, SafeUrl>();
  @Output() swiped = new EventEmitter<SwipeVerdict>();
  @Output() starToggle = new EventEmitter<void>();
  @Output() tapped = new EventEmitter<void>();
  /** Forwarded from the card: open an edited photo beside the original it came from. */
  @Output() compare = new EventEmitter<{ ids: string[]; start: number }>();
  /** This photograph turns out to be one of a group — a sweep, or several tries at one thing. */
  @Output() grouped = new EventEmitter<{ type: AssembledGroup; frames: PanoFrame[] }>();

  protected readonly quickVerdicts = QUICK_VERDICTS;
  protected readonly verdictStyle = VERDICT_STYLE;

  // The picker is opened from the strip above the card, so the flag that shows it lives with the
  // rest of "which screen is showing" rather than on either end.
  protected readonly nav = inject(NavigationService);

  /** What the picker starts from: this photograph, ringed, with its neighbours around it. */
  protected readonly seed = computed<PanoFrame[]>(() => {
    const photo = this.photo();
    return [{ id: photo.id, name: photo.name, ext: photo.ext }];
  });

  /** Done in the picker: hand the frames up, and put the card back either way. */
  protected applyFrames(frames: PanoFrame[]): void {
    const type = this.nav.groupPicking();
    this.nav.closeGroupPicker();
    if (type && frames.length > 0) this.grouped.emit({ type, frames });
  }
}
