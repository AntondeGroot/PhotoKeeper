import { Injectable, inject, signal } from '@angular/core';
import { Tag } from '../storage/photokeeper-db';
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

  /** Apply a tag to a photo (no-op if already applied). */
  apply(assetId: string, tagId: string): void {
    const current = this.tagsFor(assetId);
    if (!current.includes(tagId)) this.write(assetId, [...current, tagId]);
  }

  /** Toggle a tag on/off for a photo. */
  toggle(assetId: string, tagId: string): void {
    const current = this.tagsFor(assetId);
    const next = current.includes(tagId) ? current.filter((t) => t !== tagId) : [...current, tagId];
    this.write(assetId, next);
  }

  private write(assetId: string, tagIds: string[]): void {
    this.assignments.update((map) => ({ ...map, [assetId]: tagIds }));
    void this.assetTags.set(assetId, tagIds);
  }
}
