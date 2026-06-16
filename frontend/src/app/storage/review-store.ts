import { Injectable, inject } from '@angular/core';
import { AlbumTag, PhotoKeeperDb, StoredVerdict } from './photokeeper-db';

/** Device-local structured review state: verdicts, the per-day selection, and album tags. */
@Injectable({ providedIn: 'root' })
export class ReviewStore {
  private readonly db = inject(PhotoKeeperDb);

  // ── Verdicts ──────────────────────────────────────────────────────────────
  async getVerdicts(): Promise<Map<string, StoredVerdict>> {
    const db = await this.db.open();
    const keys = await db.getAllKeys('verdicts');
    const values = await db.getAll('verdicts');
    const map = new Map<string, StoredVerdict>();
    keys.forEach((key, i) => map.set(key, values[i]));
    return map;
  }

  async setVerdict(assetId: string, verdict: StoredVerdict): Promise<void> {
    await (await this.db.open()).put('verdicts', verdict, assetId);
  }

  // ── Daily selection ───────────────────────────────────────────────────────
  async getDailyFeed(date: string): Promise<string[] | undefined> {
    return (await this.db.open()).get('dailyFeed', date);
  }

  async setDailyFeed(date: string, assetIds: string[]): Promise<void> {
    await (await this.db.open()).put('dailyFeed', assetIds, date);
  }

  // ── Album tags ────────────────────────────────────────────────────────────
  async getAlbumTags(): Promise<Map<string, AlbumTag>> {
    const db = await this.db.open();
    const keys = await db.getAllKeys('albumTags');
    const values = await db.getAll('albumTags');
    const map = new Map<string, AlbumTag>();
    keys.forEach((key, i) => map.set(key, values[i]));
    return map;
  }

  async setAlbumTag(albumId: string, tag: AlbumTag): Promise<void> {
    await (await this.db.open()).put('albumTags', tag, albumId);
  }

  async removeAlbumTag(albumId: string): Promise<void> {
    await (await this.db.open()).delete('albumTags', albumId);
  }
}
