import { Injectable, inject, signal, untracked } from '@angular/core';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import { LightroomService } from '../lightroom.service';
import { PreviewStore } from '../storage/review/preview-store';

/** Preview size requested + cached (Lightroom 2048px preview). */
const PREVIEW_SIZE = '2048';

/**
 * A cached preview keeps both the raw object URL (so it can be revoked on eviction) and the sanitized
 * SafeUrl (stable reference, so re-reads don't re-trigger the <img> binding).
 */
interface CachedPreview {
  objectUrl: string;
  safeUrl: SafeUrl;
}

/**
 * In-memory window cache of asset previews, backed by the durable {@link PreviewStore}. Keeps the
 * photos around the review cursor decoded and ready so swiping never waits, and evicts the rest
 * (revoking their object URLs) so memory stays bounded. Also warms previews into the durable store
 * ahead of time (tomorrow's feed). {@link url} reads are reactive (cards re-render as previews land);
 * the {@link ensure}/{@link evictOutside} calls fire from the host's prefetch effect, so they read the
 * cache `untracked` to avoid re-triggering it.
 */
@Injectable({ providedIn: 'root' })
export class PreviewCacheService {
  private readonly svc = inject(LightroomService);
  private readonly previewStore = inject(PreviewStore);
  private readonly sanitizer = inject(DomSanitizer);

  // Asset id → decoded preview. A signal so the cards re-render as previews arrive.
  private readonly cache = signal<Map<string, CachedPreview>>(new Map());
  // Ids whose preview is mid-flight, so we never fire a duplicate request.
  private readonly inFlight = new Set<string>();

  // Ids whose preview could not be fetched, so the card can say so instead of rendering blank.
  private readonly failed = signal<ReadonlySet<string>>(new Set());

  /**
   * Ids held against eviction whatever the prefetch window says.
   *
   * For previews something on screen is showing from *outside* that window — the recent-decisions
   * list, whose photos all sit behind the review cursor, while the window only ever looks ahead.
   * Without this they would be evicted the moment the next decision re-ran the prefetch effect, and
   * the list would empty itself of thumbnails as you used it.
   */
  private pinned: ReadonlySet<string> = new Set();

  /** Holds a set of previews against eviction, replacing any previous pin. Empty set clears it. */
  pin(ids: ReadonlySet<string>): void {
    this.pinned = ids;
  }

  /** Whether this asset's preview was tried and failed, as opposed to simply not loaded yet. */
  unavailable(assetId: string): boolean {
    return this.failed().has(assetId);
  }

  /** The cached preview URL for an asset, or null if it isn't loaded yet. Reactive (tracks the cache). */
  url(assetId: string): SafeUrl | null {
    return this.cache().get(assetId)?.safeUrl ?? null;
  }

  /**
   * Warms an asset's preview into the in-memory cache, reading the durable store first (so a reload
   * needs no network) and only fetching when genuinely missing. Idempotent (skips ids already cached
   * or in flight). The guard read is untracked so a caller's effect doesn't re-run on every load.
   */
  async ensure(assetId: string): Promise<void> {
    const alreadyHave = untracked(() => this.cache().has(assetId) || this.inFlight.has(assetId));
    if (alreadyHave) return;

    this.inFlight.add(assetId);
    try {
      let blob = await this.previewStore.get(assetId, PREVIEW_SIZE);
      if (!blob) {
        blob = await firstValueFrom(this.svc.getPhotoBlob(assetId, PREVIEW_SIZE));
        // An empty body is not a picture. Storing one poisoned the cache permanently: every later
        // read found "a preview", skipped the network, and handed the card zero bytes to draw.
        if (blob.size === 0) throw new Error(`empty preview for ${assetId}`);
        await this.previewStore.put(assetId, PREVIEW_SIZE, blob);
      }
      const objectUrl = URL.createObjectURL(blob);
      // Safe: objectUrl is a blob: URL minted from our own fetched blob, not user input.
      // eslint-disable-next-line sonarjs/no-angular-bypass-sanitization
      const safeUrl = this.sanitizer.bypassSecurityTrustUrl(objectUrl);
      this.cache.update((cache) => new Map(cache).set(assetId, { objectUrl, safeUrl }));
    } catch {
      // Leave the gradient placeholder if the preview can't be fetched, but remember that it failed
      // — a card showing nothing at all, with nothing logged, is why a broken RAW rendition could sit
      // there invisibly instead of reading as a missing picture.
      this.failed.update((ids) => new Set(ids).add(assetId));
    } finally {
      this.inFlight.delete(assetId);
    }
  }

  /** Warms an asset's preview into the *durable* store only (precompute), skipping if already there. */
  async warmDurable(assetId: string): Promise<void> {
    if (await this.previewStore.get(assetId, PREVIEW_SIZE)) return;
    try {
      const blob = await firstValueFrom(this.svc.getPhotoBlob(assetId, PREVIEW_SIZE));
      if (blob.size === 0) return; // see ensure(): an empty body must never reach the store
      await this.previewStore.put(assetId, PREVIEW_SIZE, blob);
    } catch {
      // Best-effort; the live session will fetch it on demand.
    }
  }

  /**
   * Drops in-memory previews outside `keep` and outside the {@link pin}, revoking their object URLs
   * so memory doesn't grow without bound. Read untracked so it never re-triggers the caller's
   * prefetch effect.
   */
  evictOutside(keep: Set<string>): void {
    const cache = untracked(() => this.cache());
    const next = new Map(cache);
    let changed = false;
    for (const [id, preview] of cache) {
      if (!keep.has(id) && !this.pinned.has(id)) {
        URL.revokeObjectURL(preview.objectUrl);
        next.delete(id);
        changed = true;
      }
    }
    if (changed) this.cache.set(next);
  }

  /** Drops durable previews outside `keep` (e.g. earlier days' selections). */
  evictDurableExcept(keep: Set<string>): Promise<void> {
    return this.previewStore.evictExcept(keep);
  }

  /** Revokes and clears every in-memory preview, and any in-flight tracking (e.g. on logout/teardown). */
  revokeAll(): void {
    for (const preview of untracked(() => this.cache()).values()) {
      URL.revokeObjectURL(preview.objectUrl);
    }
    this.cache.set(new Map());
    this.inFlight.clear();
  }
}
