import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  computed,
  signal,
} from '@angular/core';
import { SafeUrl } from '@angular/platform-browser';
import { Photo } from '../../photo';
import { Tag } from '../tags';
import {
  DIR_ARROW,
  NO_TAG,
  NO_TAG_DIR,
  SWIPE_DIRS,
  SwipeDir,
  TagDirections,
  swipeDirOf,
} from '../tags';

/** Drag distance (px) past which a release counts as a directional swipe. */
const SWIPE_THRESHOLD = 70;

/**
 * The Tag review step. Swipe a keeper toward one of eight labels — four axes, four corners — to
 * apply that direction's tag and advance to the next photo (like Sort). The bottom-right corner is
 * always "no tag": the answer for a photo none of them fit.
 *
 * A drag that comes back to the middle applies nothing and keeps the photo on screen, so committing
 * is something you do, not something you fail to avoid. Unbound directions do nothing at all.
 *
 * Presentational — the host owns the pool, cursor, direction map and persistence.
 */
@Component({
  selector: 'app-tag-review',
  templateUrl: './tag-review.html',
  styleUrl: './tag-review.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TagReviewComponent {
  @Input() photo: Photo | undefined;
  @Input() imageUrl: SafeUrl | null = null;
  @Input() tags: Tag[] = [];
  @Input() directions: TagDirections = {};
  @Input() appliedTagIds: string[] = [];
  @Input() position = 0;
  @Input() total = 0;
  /** False once the keeper backlog is exhausted, so the pass stops offering more. */
  @Input() canLoadMore = true;
  /** How many photos this sitting has labelled — the done screen reports it. */
  @Input() taggedCount = 0;

  /** A directional swipe over a bound direction — the host applies that tag and advances. */
  @Output() swiped = new EventEmitter<SwipeDir>();
  /** Toggle a tag (the below chips, and the ✕ on an applied chip). */
  @Output() tagToggled = new EventEmitter<string>();
  @Output() next = new EventEmitter<void>();
  @Output() prev = new EventEmitter<void>();
  @Output() loadMore = new EventEmitter<void>();

  protected readonly dirs = SWIPE_DIRS;
  protected readonly arrow = DIR_ARROW;
  protected readonly noTagDir = NO_TAG_DIR;
  protected readonly dragX = signal(0);
  protected readonly dragY = signal(0);
  protected readonly dragTransform = computed(
    () => `translate(${this.dragX()}px, ${this.dragY()}px)`,
  );

  private dragging = false;
  private startX = 0;
  private startY = 0;

  /**
   * The tag a direction applies: the built-in "no tag" for the reserved corner, else whatever is
   * bound to it (undefined when unbound, or when its tag has since been deleted).
   */
  protected directionTag(dir: SwipeDir): Tag | undefined {
    if (dir === NO_TAG_DIR) return NO_TAG;
    const id = this.directions[dir];
    return id ? this.tags.find((t) => t.id === id) : undefined;
  }

  /** Tags not bound to any direction — shown as tappable chips below the card. */
  protected get otherTags(): Tag[] {
    const bound = new Set(Object.values(this.directions));
    return this.tags.filter((t) => !bound.has(t.id));
  }

  /**
   * The current photo's applied tags, resolved for the removable chips. The built-in "no tag" is
   * included: it is a real assignment, and one you must be able to take back off.
   */
  protected get appliedTags(): Tag[] {
    return [...this.tags, NO_TAG].filter((t) => this.appliedTagIds.includes(t.id));
  }

  protected isApplied(id: string): boolean {
    return this.appliedTagIds.includes(id);
  }

  /**
   * Whether this edge is the one a release would fire — the drag points into its 45° sector and has
   * passed the commit threshold. True for at most one edge, so the filled label always names exactly
   * the tag that would be applied; back inside the threshold nothing is lit, which is what makes
   * "return to the middle" visibly mean "nothing happens".
   */
  protected edgeActive(dir: SwipeDir): boolean {
    return this.pendingDir() === dir;
  }

  onPointerDown(event: PointerEvent): void {
    this.startX = event.clientX;
    this.startY = event.clientY;
    this.dragging = true;
    (event.currentTarget as HTMLElement | null)?.setPointerCapture(event.pointerId);
  }

  onPointerMove(event: PointerEvent): void {
    if (!this.dragging) return;
    this.dragX.set(event.clientX - this.startX);
    this.dragY.set(event.clientY - this.startY);
  }

  onPointerUp(): void {
    const dir = this.pendingDir();
    this.dragging = false;
    this.dragX.set(0);
    this.dragY.set(0);

    // No direction pending means the drag ended inside the threshold — a tap, or a drag taken back
    // to the middle. Either way the photo keeps its tag and stays where it is.
    if (dir && this.directionTag(dir)) this.swiped.emit(dir);
  }

  /** The direction the drag currently commits to, or null while it is still near the middle. */
  private pendingDir(): SwipeDir | null {
    const dx = this.dragX();
    const dy = this.dragY();
    if (Math.hypot(dx, dy) < SWIPE_THRESHOLD) return null;
    return swipeDirOf(dx, dy);
  }
}
