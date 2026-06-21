import { Injectable, inject } from '@angular/core';
import { PhotoKeeperDb, Tag } from './photokeeper-db';

/** Marks that the default tags have been seeded once, so deleting a default makes it stay deleted. */
const SEEDED_KEY = 'tagsSeeded';

/** The friendly starter set, written once on first use. Fully user-owned afterwards. */
const DEFAULT_TAGS: Tag[] = [
  { id: 'animals', name: 'Animals' },
  { id: 'family', name: 'Family' },
  { id: 'friends', name: 'Friends' },
  { id: 'nature', name: 'Nature' },
];

/** A kebab-ish slug for a new tag's id, with a uuid suffix so two same-named adds never collide. */
function slugId(name: string): string {
  // Collapse runs of non-alphanumerics to single dashes, then strip a leading/trailing one.
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-/, '')
    .replace(/-$/, '');
  return `${base || 'tag'}-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * The user's content-tag catalog (Animals, Family, …) — the editable list shown in Settings. Seeds the
 * defaults once (guarded by {@link SEEDED_KEY} so a deleted default doesn't come back), then it's fully
 * user-owned: add, rename, delete. Names are de-duplicated case-insensitively. Per-photo *assignments*
 * are a separate concern (slice 2); this is just the vocabulary.
 */
@Injectable({ providedIn: 'root' })
export class TagStore {
  private readonly db = inject(PhotoKeeperDb);

  /** Every tag, seeding the defaults on first ever call. Sorted by name for a stable display order. */
  async getAll(): Promise<Tag[]> {
    await this.seedIfNeeded();
    const tags = await (await this.db.open()).getAll('tags');
    return tags.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Adds a tag with the given name, or returns the existing one if a tag with that name already exists
   * (case-insensitive). A blank name is rejected (returns null).
   */
  async add(name: string): Promise<Tag | null> {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const existing = (await this.getAll()).find(
      (t) => t.name.toLowerCase() === trimmed.toLowerCase(),
    );
    if (existing) return existing;
    const tag: Tag = { id: slugId(trimmed), name: trimmed };
    await (await this.db.open()).put('tags', tag, tag.id);
    return tag;
  }

  /** Renames a tag in place (no-op if the id is unknown or the new name is blank). */
  async rename(id: string, name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) return;
    const db = await this.db.open();
    const tag = await db.get('tags', id);
    if (!tag) return;
    await db.put('tags', { ...tag, name: trimmed }, id);
  }

  /** Removes a tag from the catalog. A deleted default stays deleted (seeding only ever runs once). */
  async remove(id: string): Promise<void> {
    await (await this.db.open()).delete('tags', id);
  }

  private async seedIfNeeded(): Promise<void> {
    if (localStorage.getItem(SEEDED_KEY) === 'true') return;
    const db = await this.db.open();
    const tx = db.transaction('tags', 'readwrite');
    for (const tag of DEFAULT_TAGS) await tx.store.put(tag, tag.id);
    await tx.done;
    localStorage.setItem(SEEDED_KEY, 'true');
  }
}
