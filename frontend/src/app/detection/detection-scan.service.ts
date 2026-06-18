import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { LightroomService, PhotoAsset } from '../lightroom.service';
import { AlbumManifestStore } from '../storage/album-manifest-store';
import { AssetMetaStore } from '../storage/asset-meta-store';
import { GroupStore } from '../storage/group-store';
import { HashStore } from '../storage/hash-store';
import { PreviewStore } from '../storage/preview-store';
import { AssetMeta, DetectedGroup } from '../storage/photokeeper-db';
import { DetectAsset, clusterBursts } from './burst';
import { DetectionSettingsService } from './detection-settings.service';
import { ImageHasher } from './image-hasher';

/** Smallest practical Lightroom rendition for hashing; dhash downsamples to 9×8 so detail is moot. */
const HASH_RENDITION_SIZE = '640';
/** Track A warms this size for today's feed; reuse it to hash with zero extra network. */
const WARMED_PREVIEW_SIZE = '2048';

/** What one album scan did, for logging / progress. */
export interface ScanReport {
  albumId: string;
  skipped: boolean; // change-gate saw no changes → nothing fetched or hashed
  hashed: number; // assets hashed this run (added + edited)
  removed: number; // cached hashes dropped for assets that left the album
  groups: number; // burst groups stored for the album
}

/**
 * Background detection scan for one album (Track B). Gated by the album manifest so unchanged albums
 * cost one metadata fetch and nothing more. On a change it runs the tiered pipeline: cluster by
 * timestamp + camera first (no pixels) to find burst *candidates*, then hash *only* those candidate
 * members (reusing a warmed 2048 preview when present, else fetching one small rendition), then
 * re-cluster with the hashes so the Hamming check confirms real bursts. Lone photos — the bulk of a
 * catalog — are never fetched or hashed. Pure detection lives in `phash`/`burst`; this is the IO
 * orchestration around them.
 */
@Injectable({ providedIn: 'root' })
export class DetectionScanService {
  private readonly svc = inject(LightroomService);
  private readonly hasher = inject(ImageHasher);
  private readonly previews = inject(PreviewStore);
  private readonly hashes = inject(HashStore);
  private readonly groups = inject(GroupStore);
  private readonly manifests = inject(AlbumManifestStore);
  private readonly meta = inject(AssetMetaStore);
  private readonly settings = inject(DetectionSettingsService);

  async scanAlbum(albumId: string): Promise<ScanReport> {
    const assets = (await firstValueFrom(this.svc.getAllAlbumAssets(albumId))).filter(
      (a) => a.subtype === 'image',
    );

    const { unchanged, diff } = await this.manifests.scan(albumId, assets);
    if (unchanged) {
      return { albumId, skipped: true, hashed: 0, removed: 0, groups: 0 };
    }

    // Assets that left the album: drop their hash + metadata.
    for (const id of diff.removed) {
      await this.hashes.delete(id);
      await this.meta.delete(id);
    }
    // Edited assets: the cached hash is stale — drop it so Stage 2 re-hashes only if still a candidate.
    for (const id of diff.changed) {
      await this.hashes.delete(id);
    }
    // New + edited assets: refresh the cheap metadata. No pixels fetched here.
    for (const id of [...diff.added, ...diff.changed]) {
      const asset = assets.find((a) => a.id === id);
      if (asset) await this.meta.put(id, toAssetMeta(asset, albumId));
    }

    const detectAssets = assets.map(toDetectAsset);
    const opts = this.settings.burstOptions();

    // Stage 1 — candidates from timestamps alone: clusterBursts with no hashes groups on capture-time
    // proximity + camera only, so we learn which assets are even worth hashing. Lone photos drop out.
    const candidateIds = new Set(
      clusterBursts(detectAssets, new Map<string, string>(), opts).flatMap((c) => c.memberIds),
    );

    // Stage 2 — hash only candidate members that lack a cached hash (reusing a warmed preview when
    // present, else fetching one small rendition). This is the only step that touches pixels.
    const hashes = await this.hashes.getAll();
    let hashed = 0;
    for (const id of candidateIds) {
      if (hashes.has(id)) continue;
      const asset = assets.find((a) => a.id === id);
      if (!asset) continue;
      const hash = await this.hashAsset(asset);
      await this.hashes.put(id, hash);
      hashes.set(id, hash); // keep the in-memory map current for Stage 3
      hashed++;
    }

    // Stage 3 — confirm with perceptual hashes: the Hamming check splits time-close but visually
    // distinct shots, leaving real bursts.
    const groups = clusterBursts(detectAssets, hashes, opts).map(
      (c): DetectedGroup => ({ type: 'burst', sourceAlbumId: albumId, memberIds: c.memberIds }),
    );
    await this.groups.replaceForAlbum(albumId, groups);

    // Record only after a clean run, so a failure re-scans the album next time.
    await this.manifests.record(albumId, assets);
    return { albumId, skipped: false, hashed, removed: diff.removed.length, groups: groups.length };
  }

  /** Hashes one asset, reusing a warmed 2048 preview if cached, else fetching the small rendition. */
  private async hashAsset(asset: PhotoAsset): Promise<string> {
    const warmed = await this.previews.get(asset.id, WARMED_PREVIEW_SIZE);
    const blob =
      warmed ?? (await firstValueFrom(this.svc.getPhotoBlob(asset.id, HASH_RENDITION_SIZE)));
    return this.hasher.hash(blob);
  }
}

function toDetectAsset(asset: PhotoAsset): DetectAsset {
  return { id: asset.id, taken: asset.payload?.captureDate ?? '' };
}

function toAssetMeta(asset: PhotoAsset, albumId: string): AssetMeta {
  const name = (asset.payload?.importSource?.fileName ?? asset.id).replace(/\.[^.]+$/, '');
  return { albumId, name, taken: asset.payload?.captureDate ?? '' };
}
