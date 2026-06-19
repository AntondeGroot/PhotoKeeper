import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { LightroomService, PhotoAsset } from '../lightroom.service';
import { AlbumManifestStore } from '../storage/album-manifest-store';
import { AssetMetaStore } from '../storage/asset-meta-store';
import { SignatureStore } from '../storage/signature-store';
import { AspectStore } from '../storage/aspect-store';
import { GroupStore } from '../storage/group-store';
import { HashStore } from '../storage/hash-store';
import { PreviewStore } from '../storage/preview-store';
import { AssetMeta, DetectedGroup, FrameSignature } from '../storage/photokeeper-db';
import { DetectAsset, clusterBursts } from './burst';
import { PanoAsset, clusterPanos } from './pano';
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
 * timestamp + camera first (no pixels) to find candidate runs, then hash *only* those candidate
 * members (whole-frame hash + grayscale signature, reusing a warmed 2048 preview when present, else
 * fetching one small rendition), then re-cluster: the Hamming check confirms real bursts, and the
 * slide-matcher confirms panos. Lone photos — the bulk of a catalog — are never fetched or hashed.
 * Pure detection lives in `phash`/`burst`/`pano`; this is the IO orchestration around them.
 */
@Injectable({ providedIn: 'root' })
export class DetectionScanService {
  private readonly svc = inject(LightroomService);
  private readonly hasher = inject(ImageHasher);
  private readonly previews = inject(PreviewStore);
  private readonly hashes = inject(HashStore);
  private readonly signatures = inject(SignatureStore);
  private readonly aspects = inject(AspectStore);
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

    // Assets that left the album: drop their hashes + metadata.
    for (const id of diff.removed) {
      await this.hashes.delete(id);
      await this.signatures.delete(id);
      await this.aspects.delete(id);
      await this.meta.delete(id);
    }
    // Edited assets: cached hashes are stale — drop them so Stage 2 re-hashes only if still a candidate.
    for (const id of diff.changed) {
      await this.hashes.delete(id);
      await this.signatures.delete(id);
      await this.aspects.delete(id);
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

    // Stage 2 — hash only candidate members that lack cached data (reusing a warmed preview when
    // present, else fetching one small rendition). Computes the whole-frame hash (burst), the grayscale
    // signature and the aspect ratio (pano) from the same blob. This is the only step that touches pixels.
    const hashes = await this.hashes.getAll();
    const signatures = await this.signatures.getAll();
    const aspects = await this.aspects.getAll();
    let hashed = 0;
    for (const id of candidateIds) {
      if (hashes.has(id) && signatures.has(id) && aspects.has(id)) continue;
      const asset = assets.find((a) => a.id === id);
      if (!asset) continue;
      const { hash, signature, aspect } = await this.computeHashes(asset);
      await this.hashes.put(id, hash);
      hashes.set(id, hash); // keep the in-memory maps current for Stage 3
      await this.signatures.put(id, signature);
      signatures.set(id, signature);
      await this.aspects.put(id, aspect);
      aspects.set(id, aspect);
      hashed++;
    }

    // Stage 3 — confirm with the hashes: the Hamming check splits time-close but visually distinct
    // shots into real bursts; clusterPanos slides signatures to confirm a pan. Panos overlapping a
    // detected burst are dropped (a frame belongs to one group).
    const burstGroups = clusterBursts(detectAssets, hashes, opts).map(
      (c): DetectedGroup => ({ type: 'burst', sourceAlbumId: albumId, memberIds: c.memberIds }),
    );
    const inBurst = new Set(burstGroups.flatMap((g) => g.memberIds));
    const panoAssets = assets.map((a): PanoAsset => toPanoAsset(a, aspects.get(a.id)));
    const panoGroups = clusterPanos(panoAssets, signatures, hashes, this.settings.panoOptions())
      .filter((c) => !c.memberIds.some((id) => inBurst.has(id)))
      .map(
        (c): DetectedGroup => ({
          type: 'pano',
          sourceAlbumId: albumId,
          memberIds: c.memberIds,
          orientation: c.orientation,
        }),
      );
    const groups = [...burstGroups, ...panoGroups];
    await this.groups.replaceForAlbum(albumId, groups);

    // Record only after a clean run, so a failure re-scans the album next time.
    await this.manifests.record(albumId, assets);
    return { albumId, skipped: false, hashed, removed: diff.removed.length, groups: groups.length };
  }

  /** Hash + signature + aspect for one asset, from a warmed 2048 preview or a fetched rendition. */
  private async computeHashes(
    asset: PhotoAsset,
  ): Promise<{ hash: string; signature: FrameSignature; aspect: number }> {
    const warmed = await this.previews.get(asset.id, WARMED_PREVIEW_SIZE);
    const blob =
      warmed ?? (await firstValueFrom(this.svc.getPhotoBlob(asset.id, HASH_RENDITION_SIZE)));
    return {
      hash: await this.hasher.hash(blob),
      signature: await this.hasher.signature(blob),
      aspect: await this.hasher.aspect(blob),
    };
  }
}

function toDetectAsset(asset: PhotoAsset): DetectAsset {
  return { id: asset.id, taken: asset.payload?.captureDate ?? '' };
}

function toPanoAsset(asset: PhotoAsset, aspect: number | undefined): PanoAsset {
  return { id: asset.id, taken: asset.payload?.captureDate ?? '', aspect };
}

function toAssetMeta(asset: PhotoAsset, albumId: string): AssetMeta {
  const name = (asset.payload?.importSource?.fileName ?? asset.id).replace(/\.[^.]+$/, '');
  return { albumId, name, taken: asset.payload?.captureDate ?? '' };
}
