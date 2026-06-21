import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  signal,
} from '@angular/core';
import { Tag } from '../storage/photokeeper-db';

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
  @Output() added = new EventEmitter<string>();
  @Output() renamed = new EventEmitter<{ id: string; name: string }>();
  @Output() removed = new EventEmitter<string>();
  @Output() back = new EventEmitter<void>();

  /** The draft name in the "add a tag" field. */
  protected readonly draft = signal('');

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
