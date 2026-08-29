import { Injectable, inject, signal } from '@angular/core';
import { Tag } from './tags';
import { TagStore } from '../storage/tags/tag-store';
import { AssetTagStore } from '../storage/tags/asset-tag-store';

/**
 * The content-tag data layer: the editable catalog ({@link tags}) and the per-photo assignments
 * ({@link assignments}), both backed by IndexedDB. Owns loading, catalog CRUD, and applying/removing
 * tags on a photo. Pure data — no review-session coupling; the component derives the keepers pool,
 * cursor and progress from this plus the review feed.
 */
@Injectable({ providedIn: 'root' })
export class TagState {
  private readonly tagStore = inject(TagStore);
  private readonly assetTags = inject(AssetTagStore);

  /** The user's tag catalog (Animals, Family, …), sorted by name. */
  readonly tags = signal<Tag[]>([]);
  /** assetId → applied tag ids. */
  readonly assignments = signal<Record<string, string[]>>({});

  /**
   * Reloads the catalog and the assignments — independently, so a failure loading one never hides the
   * other (and so an error is visible rather than silently swallowed).
   */
  async refresh(): Promise<void> {
    try {
      this.tags.set(await this.tagStore.getAll());
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Tag catalog failed to load', e);
    }
    try {
      this.assignments.set(await this.assetTags.getAll());
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Tag assignments failed to load', e);
    }
  }

  /** Add a tag (de-duplicated by name in the store), then refresh. */
  async add(name: string): Promise<void> {
    await this.tagStore.add(name);
    await this.refresh();
  }

  /** Rename a tag in place, then refresh. */
  async rename(id: string, name: string): Promise<void> {
    await this.tagStore.rename(id, name);
    await this.refresh();
  }

  /** Delete a tag from the catalog (a removed default stays removed), then refresh. */
  async remove(id: string): Promise<void> {
    await this.tagStore.remove(id);
    await this.refresh();
  }

  /** The tag ids applied to a photo. */
  tagsFor(assetId: string): string[] {
    return this.assignments()[assetId] ?? [];
  }

  /**
   * Give a photo a tag, replacing whatever it had.
   *
   * A photo carries one tag, not a set: the Tag step asks "what is this a photo *of*", and a single
   * swipe answers it. Applying a second tag therefore corrects the first rather than adding to it.
   * The stored shape stays a list — it is what IndexedDB holds and what a Lightroom keyword sync
   * would want — so a photo labelled under the older, multi-tag behaviour still reads back whole.
   */
  apply(assetId: string, tagId: string): void {
    if (this.tagsFor(assetId).join() === tagId) return; // already exactly this tag
    this.write(assetId, [tagId]);
  }

  /** Tapping a tag: the photo's tag if it wasn't already, otherwise no tag at all. */
  toggle(assetId: string, tagId: string): void {
    if (this.tagsFor(assetId).includes(tagId)) {
      this.write(
        assetId,
        this.tagsFor(assetId).filter((t) => t !== tagId),
      );
      return;
    }
    this.apply(assetId, tagId);
  }

  private write(assetId: string, tagIds: string[]): void {
    this.assignments.update((map) => ({ ...map, [assetId]: tagIds }));
    void this.assetTags.set(assetId, tagIds);
  }
}
