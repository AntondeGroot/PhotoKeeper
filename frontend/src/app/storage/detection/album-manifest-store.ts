import { Injectable, inject } from '@angular/core';
import { AlbumManifest, AssetFingerprint, PhotoKeeperDb } from '../photokeeper-db';

/** The outcome of comparing a fresh album population against its stored manifest. */
export interface ManifestDiff {
  added: string[]; // asset ids present now but not in the stored manifest
  removed: string[]; // asset ids in the stored manifest but gone now
  changed: string[]; // asset ids present in both whose `updated` stamp moved (edited/replaced)
}

/** Minimal asset shape the change-gate needs — id plus the Lightroom revision stamp. */
export interface ManifestAsset {
  id: string;
  updated?: string;
}

/** Sorted `id + updated` fingerprints for an album's assets. Sorted so the hash is order-independent. */
export function fingerprintsOf(assets: readonly ManifestAsset[]): AssetFingerprint[] {
  return assets
    .map((a) => ({ id: a.id, updated: a.updated ?? '' }))
    .sort((x, y) => x.id.localeCompare(y.id));
}

/** Builds the manifest stored after a scan: fingerprints, a hash over them, a cursor, and a timestamp. */
export function computeAlbumManifest(
  assets: readonly ManifestAsset[],
  scanned = 0,
  now: number = Date.now(),
): AlbumManifest {
  const fingerprints = fingerprintsOf(assets);
  return { hash: hashFingerprints(fingerprints), fingerprints, scanned, computedAt: now };
}

/**
 * Diffs a stored manifest against the current population. With no stored manifest, every asset is
 * "added". Cheap path: callers can compare {@link AlbumManifest.hash} first and skip this entirely
 * when the hashes match.
 */
export function diffManifest(
  stored: AlbumManifest | undefined,
  currentAssets: readonly ManifestAsset[],
): ManifestDiff {
  const current = fingerprintsOf(currentAssets);
  const prev = new Map((stored?.fingerprints ?? []).map((f) => [f.id, f.updated]));
  const curr = new Map(current.map((f) => [f.id, f.updated]));

  const added: string[] = [];
  const changed: string[] = [];
  for (const [id, updated] of curr) {
    if (!prev.has(id)) added.push(id);
    else if (prev.get(id) !== updated) changed.push(id);
  }
  const removed = [...prev.keys()].filter((id) => !curr.has(id));
  return { added, removed, changed };
}

/** FNV-1a (32-bit) over the sorted fingerprints → an 8-char hex digest. */
function hashFingerprints(fingerprints: readonly AssetFingerprint[]): string {
  const joined = fingerprints.map((f) => `${f.id}@${f.updated}`).join('\n');
  let hash = 0x811c9dc5;
  for (let i = 0; i < joined.length; i++) {
    hash ^= joined.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Device-local record of each album's last-scanned population (albumId → manifest). The background
 * detection scan reads it through {@link scan} to learn which assets changed since the previous run,
 * then writes the fresh manifest once the scan completes.
 */
@Injectable({ providedIn: 'root' })
export class AlbumManifestStore {
  private readonly db = inject(PhotoKeeperDb);

  async get(albumId: string): Promise<AlbumManifest | undefined> {
    return (await this.db.open()).get('albumManifest', albumId);
  }

  async put(albumId: string, manifest: AlbumManifest): Promise<void> {
    await (await this.db.open()).put('albumManifest', manifest, albumId);
  }

  async delete(albumId: string): Promise<void> {
    await (await this.db.open()).delete('albumManifest', albumId);
  }

  /**
   * Drops every stored manifest, so the next scan re-detects every album. Used when a detection
   * threshold changes — album *content* is unchanged, so the gate would otherwise skip everything.
   */
  async clear(): Promise<void> {
    await (await this.db.open()).clear('albumManifest');
  }

  /**
   * The change-gate. Returns `unchanged: true` when the album's population hash matches the stored
   * manifest (skip it); otherwise the diff of added/removed/changed asset ids to act on. Does not
   * persist — call {@link record} after a scan succeeds so a failed scan re-runs next time.
   */
  async scan(
    albumId: string,
    currentAssets: readonly ManifestAsset[],
  ): Promise<{ unchanged: boolean; diff: ManifestDiff; scanned: number }> {
    const stored = await this.get(albumId);
    const current = computeAlbumManifest(currentAssets);
    const scanned = stored?.scanned ?? 0;
    if (stored && stored.hash === current.hash) {
      return { unchanged: true, diff: { added: [], removed: [], changed: [] }, scanned };
    }
    return { unchanged: false, diff: diffManifest(stored, currentAssets), scanned };
  }

  /**
   * Persists the album's current population plus how far the incremental scan has reached, so the next
   * {@link scan} compares against it and resumes from `scanned`.
   */
  async record(
    albumId: string,
    currentAssets: readonly ManifestAsset[],
    scanned = 0,
  ): Promise<void> {
    await this.put(albumId, computeAlbumManifest(currentAssets, scanned));
  }
}
