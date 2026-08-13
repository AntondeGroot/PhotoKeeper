import { Injectable, inject } from '@angular/core';
import { ReviewItem } from '../../photo';
import { AlbumTag, PhotoKeeperDb, StoredVerdict } from '../photokeeper-db';

/** Device-local structured review state: verdicts, the per-day selection, and album tags. */
@Injectable({ providedIn: 'root' })
export class ReviewStore {
  private readonly db = inject(PhotoKeeperDb);

  /** The whole verdict map once read; kept in step by {@link setVerdict}. */
  private verdicts: Map<string, StoredVerdict> | null = null;

  // ── Verdicts ──────────────────────────────────────────────────────────────

  /**
   * Every verdict, cached after the first read.
   *
   * Reading them is two full scans of the store plus building a map of the whole library, and it
   * happens constantly — the feed build, the daily selection, the background scan, the streak's
   * backlog check on every app open, the session totals, the tag pass. Doing that work once a
   * session instead of once a caller is most of the cost gone.
   *
   * Safe to cache because this store is the only thing that writes verdicts, so nothing can change
   * them behind its back. {@link setVerdict} updates the cache rather than dropping it: a decision
   * is a single-entry change, and invalidating on every swipe would mean rebuilding the map
   * constantly during exactly the activity that touches it most.
   *
   * The returned map is shared, not copied — treat it as read-only.
   */
  async getVerdicts(): Promise<Map<string, StoredVerdict>> {
    if (this.verdicts) return this.verdicts;

    const db = await this.db.open();
    const keys = await db.getAllKeys('verdicts');
    const values = await db.getAll('verdicts');
    const map = new Map<string, StoredVerdict>();
    keys.forEach((key, i) => map.set(key, values[i]));
    this.verdicts = map;
    return map;
  }

  async setVerdict(assetId: string, verdict: StoredVerdict): Promise<void> {
    await (await this.db.open()).put('verdicts', verdict, assetId);
    this.verdicts?.set(assetId, verdict); // write through, so the cache stays warm
  }

  // ── Daily selection ───────────────────────────────────────────────────────
  async getDailyFeed(date: string): Promise<ReviewItem[] | undefined> {
    return (await this.db.open()).get('dailyFeed', date);
  }

  async setDailyFeed(date: string, units: ReviewItem[]): Promise<void> {
    await (await this.db.open()).put('dailyFeed', units, date);
  }

  /** Drops stored selections for days outside `keep` (date keys), so old days don't accumulate. */
  async pruneDailyFeedExcept(keep: Set<string>): Promise<void> {
    const db = await this.db.open();
    const keys = await db.getAllKeys('dailyFeed');
    await Promise.all(keys.filter((k) => !keep.has(k)).map((k) => db.delete('dailyFeed', k)));
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
