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

  /**
   * The verdicts already in hand, or null when nothing has read them yet.
   *
   * For the one caller that cannot wait: undo has to record what a verdict *was* in the same tick as
   * the decision that overwrites it, because {@link setVerdict} writes through to the cached map and
   * an awaited read would come back holding the new value. Null in practice never happens — a deck
   * cannot exist before {@link ReviewFeedService#loadToday} has awaited the verdicts to apply them —
   * and undo simply declines to record rather than guessing if it ever does.
   */
  loadedVerdicts(): ReadonlyMap<string, StoredVerdict> | null {
    return this.verdicts;
  }

  /**
   * Takes a verdict away entirely, returning the photo to the backlog.
   *
   * Deleted rather than stored as 'backlog': the two are the same to the review flow but not to the
   * Lightroom sweep, which reads every stored verdict, nor to the storage report, which counts them.
   */
  async removeVerdict(assetId: string): Promise<void> {
    await (await this.db.open()).delete('verdicts', assetId);
    this.verdicts?.delete(assetId);
  }

  /**
   * Flips one photo's "keep it, don't print it" choice, leaving the rest of its verdict untouched.
   *
   * A photo with no verdict is ignored rather than given one: the choice is made on the Prints tab,
   * over photos that have already been sorted, so an id with nothing stored is a photo that has no
   * business being there.
   */
  async setSaveOnly(assetId: string, saveOnly: boolean): Promise<void> {
    const verdict = (await this.getVerdicts()).get(assetId);
    if (!verdict) return;
    await this.setVerdict(assetId, { ...verdict, saveOnly });
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
