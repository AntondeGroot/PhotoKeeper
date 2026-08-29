import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  signal,
} from '@angular/core';
import { Tag } from '../tags';
import {
  ASSIGNABLE_DIRS,
  DIR_ARROW,
  DIR_LABEL,
  NO_TAG,
  NO_TAG_DIR,
  SwipeDir,
  TagDirections,
} from '../tags';

/**
 * The content-tag catalog editor (Settings → Tags). Presentational: the host owns the {@link TagStore}
 * and passes the list in; this emits intents (add / rename / remove). Tags are per-photo content labels
 * (Animals, Family, …), distinct from the album-level vacation/stereo profiles.
 */
@Component({
  selector: 'app-tag-manager',
  templateUrl: './tag-manager.html',
  styleUrl: './tag-manager.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TagManagerComponent {
  @Input() tags: Tag[] = [];
  @Input() directions: TagDirections = {};
  @Output() added = new EventEmitter<string>();
  @Output() renamed = new EventEmitter<{ id: string; name: string }>();
  @Output() removed = new EventEmitter<string>();
  /** A swipe direction was bound to a tag id (or unbound when null). */
  @Output() directionChanged = new EventEmitter<{ dir: SwipeDir; tagId: string | null }>();
  @Output() back = new EventEmitter<void>();

  /** Only the seven directions a tag may be bound to — the eighth is the reserved "no tag" corner. */
  protected readonly dirs = ASSIGNABLE_DIRS;
  protected readonly arrow = DIR_ARROW;
  protected readonly dirLabel = DIR_LABEL;
  protected readonly noTagDir = NO_TAG_DIR;
  protected readonly noTag = NO_TAG;

  /** The draft name in the "add a tag" field. */
  protected readonly draft = signal('');

  /**
   * The tags this direction can be pointed at: the ones not already spoken for, plus its own.
   *
   * A tag lives on one direction — binding it elsewhere silently clears the old one — so listing
   * every tag on every row offers choices that quietly undo another. Its own binding stays in the
   * list because that is what the control has to show as selected.
   */
  protected optionsFor(dir: SwipeDir): Tag[] {
    const taken = new Set(
      Object.entries(this.directions)
        .filter(([bound, tagId]) => bound !== dir && tagId)
        .map(([, tagId]) => tagId),
    );
    return this.tags.filter((tag) => !taken.has(tag.id));
  }

  /** The tag currently on a direction, for the closed control's label. */
  protected boundTag(dir: SwipeDir): Tag | undefined {
    const id = this.directions[dir];
    return id ? this.tags.find((tag) => tag.id === id) : undefined;
  }

  protected onDirectionChange(dir: SwipeDir, event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.directionChanged.emit({ dir, tagId: value || null });
  }

  protected setDraft(event: Event): void {
    this.draft.set((event.target as HTMLInputElement).value);
  }

  protected commitAdd(): void {
    const name = this.draft().trim();
    if (!name) return;
    this.added.emit(name);
    this.draft.set('');
  }

  protected onRename(id: string, event: Event): void {
    const name = (event.target as HTMLInputElement).value.trim();
    if (name) this.renamed.emit({ id, name });
  }
}
