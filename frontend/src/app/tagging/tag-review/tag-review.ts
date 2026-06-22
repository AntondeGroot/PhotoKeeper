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
import { DIR_ARROW, SWIPE_DIRS, SwipeDir, TagDirections } from '../tags';

/** Drag distance (px) past which a release counts as a directional swipe. */
const SWIPE_THRESHOLD = 70;

/** The dominant swipe direction of a drag vector (the larger axis decides). */
function dominantDir(dx: number, dy: number): SwipeDir {
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'left' : 'right';
  return dy < 0 ? 'up' : 'down';
}

/**
 * The Tag review step. Swipe a keeper in one of four directions to apply that direction's bound tag
 * and advance to the next photo (like Sort). The bound tags are shown as edge labels; any other tags
 * sit below as tappable chips. The current photo's applied tags show as removable chips so a mis-swipe
 * can be undone. Presentational — the host owns the pool, cursor, direction map and persistence.
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

  /** A directional swipe over a bound direction — the host applies that tag and advances. */
  @Output() swiped = new EventEmitter<SwipeDir>();
  /** Toggle a tag (the below chips, and the ✕ on an applied chip). */
  @Output() tagToggled = new EventEmitter<string>();
  @Output() next = new EventEmitter<void>();
  @Output() prev = new EventEmitter<void>();

  protected readonly dirs = SWIPE_DIRS;
  protected readonly arrow = DIR_ARROW;
  protected readonly dragX = signal(0);
  protected readonly dragY = signal(0);
  protected readonly dragTransform = computed(
    () => `translate(${this.dragX()}px, ${this.dragY()}px)`,
  );

  private dragging = false;
  private startX = 0;
  private startY = 0;

  /** The tag bound to a direction (undefined if unbound or its tag was deleted). */
  protected directionTag(dir: SwipeDir): Tag | undefined {
    const id = this.directions[dir];
    return id ? this.tags.find((t) => t.id === id) : undefined;
  }

  /** Tags not bound to any direction — shown as tappable chips below the card. */
  protected get otherTags(): Tag[] {
    const bound = new Set(Object.values(this.directions));
    return this.tags.filter((t) => !bound.has(t.id));
  }

  /** The current photo's applied tags, resolved to catalog entries (for the removable chips). */
  protected get appliedTags(): Tag[] {
    return this.tags.filter((t) => this.appliedTagIds.includes(t.id));
  }

  protected isApplied(id: string): boolean {
    return this.appliedTagIds.includes(id);
  }

  /**
   * Whether this edge is the one a release would fire — i.e. it's the *dominant* drag direction and the
   * drag has passed the commit threshold. Only ever true for a single edge, so the filled label always
   * shows exactly which tag will be applied (no ambiguous double-highlight on a diagonal drag).
   */
  protected edgeActive(dir: SwipeDir): boolean {
    const dx = this.dragX();
    const dy = this.dragY();
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_THRESHOLD) return false;
    return dir === dominantDir(dx, dy);
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
    const dx = this.dragX();
    const dy = this.dragY();
    this.dragging = false;
    this.dragX.set(0);
    this.dragY.set(0);

    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_THRESHOLD) return; // a tap / too short: ignore
    const dir = dominantDir(dx, dy);
    if (this.directionTag(dir)) this.swiped.emit(dir); // only act when that direction is bound
  }
}
