import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  signal,
} from '@angular/core';
import { Tag } from '../../storage/photokeeper-db';
import { DIR_ARROW, DIR_LABEL, SWIPE_DIRS, SwipeDir, TagDirections } from '../tags';

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

  protected readonly dirs = SWIPE_DIRS;
  protected readonly arrow = DIR_ARROW;
  protected readonly dirLabel = DIR_LABEL;

  /** The draft name in the "add a tag" field. */
  protected readonly draft = signal('');

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
