import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { LightroomService, PhotoAsset } from '../lightroom.service';
import { AlbumManifestStore } from '../storage/album-manifest-store';
import { AssetMetaStore } from '../storage/asset-meta-store';
import { GroupStore } from '../storage/group-store';
import { HashStore } from '../storage/hash-store';
import { PreviewStore } from '../storage/preview-store';
import { AssetMeta, DetectedGroup } from '../storage/photokeeper-db';
import { BurstOptions, DetectAsset, clusterBursts } from './burst';
import { ImageHasher } from './image-hasher';

/** Smallest practical Lightroom rendition for hashing; dhash downsamples to 9×8 so detail is moot. */
const HASH_RENDITION_SIZE = '640';
/** Track A warms this size for today's feed; reuse it to hash with zero extra network. */
const WARMED_PREVIEW_SIZE = '2048';

/**
 * Provisional burst thresholds. The unit tests prove the wiring, not these numbers — tune them
 * against the labeled benchmark corpus (see docs/track-b-detection.md).
 */
const BURST_OPTS: BurstOptions = { windowMs: 3000, maxHamming: 10, minSize: 2 };

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
 * cost one metadata fetch and nothing more; on a change it hashes only the touched assets (reusing a
 * warmed 2048 preview when present, else fetching the smallest rendition), re-clusters bursts over the
 * whole album, and stores the resulting groups. Pure detection lives in `phash`/`burst`; this is the
 * IO orchestration around them.
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

  async scanAlbum(albumId: string): Promise<ScanReport> {
    const assets = (await firstValueFrom(this.svc.getAllAlbumAssets(albumId))).filter(
      (a) => a.subtype === 'image',
    );

    const { unchanged, diff } = await this.manifests.scan(albumId, assets);
    if (unchanged) {
      return { albumId, skipped: true, hashed: 0, removed: 0, groups: 0 };
    }

    // Assets that left the album: drop their hash + metadata (their group is rebuilt below).
    for (const id of diff.removed) {
      await this.hashes.delete(id);
      await this.meta.delete(id);
    }

    // New + edited assets need a (re)hash and fresh metadata; everything else keeps its cached entries.
    const toHash = [...diff.added, ...diff.changed];
    for (const id of toHash) {
      const asset = assets.find((a) => a.id === id);
      if (asset) {
        await this.hashes.put(id, await this.hashAsset(asset));
        await this.meta.put(id, toAssetMeta(asset, albumId));
      }
    }

    const hashes = await this.hashes.getAll();
    const clusters = clusterBursts(assets.map(toDetectAsset), hashes, BURST_OPTS);
    const groups = clusters.map(
      (c): DetectedGroup => ({ type: 'burst', sourceAlbumId: albumId, memberIds: c.memberIds }),
    );
    await this.groups.replaceForAlbum(albumId, groups);

    // Record only after a clean run, so a failure re-scans the album next time.
    await this.manifests.record(albumId, assets);
    return {
      albumId,
      skipped: false,
      hashed: toHash.length,
      removed: diff.removed.length,
      groups: groups.length,
    };
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
