import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { LightroomService } from '../../lightroom.service';
import { PhotoAsset } from '../../lightroom-types';
import { AlbumManifestStore } from '../../storage/detection/album-manifest-store';
import { AssetMetaStore } from '../../storage/review/asset-meta-store';
import { SignatureStore } from '../../storage/detection/signature-store';
import { AspectStore } from '../../storage/detection/aspect-store';
import { GroupStore } from '../../storage/detection/group-store';
import { HashStore } from '../../storage/detection/hash-store';
import { PreviewStore } from '../../storage/review/preview-store';
import { splitFileName } from '../../photo';
import { cameraSerial, isCaptureFrame } from '../../camera-metadata';
import { AssetMeta } from '../../storage/photokeeper-db';
import { DetectedGroup, FrameSignature, StereoRole } from '../detectors/detection-types';
import { DetectAsset, clusterBursts } from '../detectors/burst';
import { PanoAsset, clusterPanos } from '../detectors/pano';
import { StereoAsset, clusterStereo, mergeOverlappingSets } from '../detectors/stereo';
import { DetectionSettingsService } from './detection-settings.service';
import { ImageHasher } from '../detectors/image-hasher';

/** Smallest practical Lightroom rendition for hashing; dhash downsamples to 9×8 so detail is moot. */
const HASH_RENDITION_SIZE = '640';
/** Track A warms this size for today's feed; reuse it to hash with zero extra network. */
const WARMED_PREVIEW_SIZE = '2048';

/** What one album scan did, for logging / progress. */
export interface ScanReport {
  albumId: string;
  skipped: boolean; // change-gate saw no changes and the album was already fully scanned
  hashed: number; // assets hashed this run (added + edited)
  removed: number; // cached hashes dropped for assets that left the album
  groups: number; // burst groups stored for the album
  scanned: number; // images newly covered this pass (drawn from the budget)
  exhausted: boolean; // the album is now fully scanned (cursor reached the end)
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

  /**
   * Scans the next slice of one album, in capture-time order, up to `budget` new images — a *soft* cap:
   * once the budget is reached it keeps going while consecutive captures stay within the group window
   * (so a burst/pano straddling the cap is finished, not cut), and peeks one photo past to confirm the
   * boundary. A per-album cursor (in the manifest) records how far it reached, so the next pass resumes
   * there; the cursor resets and the album re-scans from the start whenever its population changes.
   */
  async scanAlbum(
    albumId: string,
    budget: number,
    stereoRole: StereoRole | null = null,
  ): Promise<ScanReport> {
    // Capture-time order makes "the next photo" and the group-window peek well-defined.
    const all = (await firstValueFrom(this.svc.getAllAlbumAssets(albumId)))
      .filter((a) => a.subtype === 'image')
      .sort((a, b) => takenOf(a).localeCompare(takenOf(b)));

    const { unchanged, diff } = await this.manifests.scan(albumId, all);
    const stored = unchanged ? ((await this.manifests.get(albumId))?.scanned ?? 0) : 0;

    // Nothing changed and the whole album is already scanned → skip without spending budget.
    if (unchanged && stored >= all.length) {
      return {
        albumId,
        skipped: true,
        hashed: 0,
        removed: 0,
        groups: 0,
        scanned: 0,
        exhausted: true,
      };
    }

    // Population changed → drop stale per-asset caches; the cursor is already reset to 0 above, so the
    // album re-scans from the start (cheap: hashes are cached for unchanged assets).
    if (!unchanged) {
      for (const id of [...diff.removed, ...diff.changed]) {
        await this.hashes.delete(id);
        await this.signatures.delete(id);
        await this.aspects.delete(id);
      }
      for (const id of diff.removed) await this.meta.delete(id);
    }

    const cursor = stored;
    const end = this.windowEnd(all, cursor, budget);

    // Refresh the cheap metadata for the newly-covered slice. No pixels fetched here.
    for (let i = cursor; i < end; i++) {
      await this.meta.put(all[i].id, toAssetMeta(all[i], albumId));
    }

    // Detection runs on the whole scanned prefix [0, end): both ends sit at a time-gap (the previous
    // pass stopped at one, and we extended this one to one), so no group is split. Re-clustering the
    // prefix is cheap — Stage 2 only hashes the new, un-cached candidates.
    const prefix = all.slice(0, end);
    const { hashed, groups } = await this.detectPrefix(albumId, prefix, stereoRole);

    await this.manifests.record(albumId, all, end);
    return {
      albumId,
      skipped: false,
      hashed,
      removed: diff.removed.length,
      groups: groups.length,
      scanned: end - cursor,
      exhausted: end >= all.length,
    };
  }

  /**
   * Where this pass stops: `cursor + budget`, then extended while consecutive captures stay within the
   * group window (finishing a straddling burst/pano), which also peeks the photo just past the cap to
   * confirm it's a real boundary. Always advances at least one image so a pass can't stall.
   */
  private windowEnd(all: PhotoAsset[], cursor: number, budget: number): number {
    const gapMs = Math.max(
      this.settings.burstOptions().windowMs,
      this.settings.panoOptions().windowMs,
    );
    let end = Math.min(cursor + Math.max(budget, 1), all.length);
    while (end < all.length && withinGap(all[end - 1], all[end], gapMs)) end++;
    return end;
  }

  /** Runs the tiered burst/pano/stereo detection over a scanned prefix and stores its groups. */
  private async detectPrefix(
    albumId: string,
    prefix: PhotoAsset[],
    stereoRole: StereoRole | null,
  ): Promise<{ hashed: number; groups: DetectedGroup[] }> {
    const candidateIds = this.candidateFrames(prefix, stereoRole);
    // The only step that touches pixels: hash the candidates that lack cached data.
    const { hashed, hashes, signatures, aspects } = await this.hashCandidates(prefix, candidateIds);

    const groups = this.groupsFor(stereoRole, albumId, prefix, hashes, signatures, aspects);
    await this.groups.replaceForAlbum(albumId, groups);
    return { hashed, groups };
  }

  /**
   * What counts as a group in this album, which its stereo marking decides outright.
   *
   * A **left- or right-eye album has no groups of its own at all**: every frame in it is half of a
   * shot whose other half is in the *other* album, so anything found within one album is two
   * different photographs rather than one. Left to the ordinary detectors, two near-identical left
   * eyes — the same scene shot twice — came back as a burst, and review asked which of two separate
   * stereographs was the better photograph. Their pairing happens across the two albums, at selection
   * time (see stereo-pairing.ts).
   */
  private groupsFor(
    stereoRole: StereoRole | null,
    albumId: string,
    prefix: PhotoAsset[],
    hashes: Map<string, string>,
    signatures: Map<string, FrameSignature>,
    aspects: Map<string, number>,
  ): DetectedGroup[] {
    if (stereoRole === 'left' || stereoRole === 'right') return [];
    if (stereoRole === 'both') return this.stereoSets(albumId, prefix, hashes, signatures, aspects);
    return this.mixedGroups(albumId, prefix, hashes, signatures, aspects);
  }

  /**
   * Stage 1 — which frames are worth hashing, from timestamps alone (no pixels). Lone photos drop
   * out.
   *
   * **Every image in a stereo album is hashed**, whichever eye it holds, because in a stereo album
   * the hash is the whole signal and the time-cluster gate would withhold it. Within one album a
   * stereo set isn't time-bounded (the photographer moves between positions, and may pause for
   * movement to settle). Across two albums it is worse than that: the frames that pair are in
   * *different* albums, so nothing in a left-eye album ever forms a time cluster and almost nothing
   * in it was ever hashed — which left the cross-album matcher with no picture to compare and
   * nothing to go on but two clocks that were never required to agree.
   */
  private candidateFrames(prefix: PhotoAsset[], stereoRole: StereoRole | null): Set<string> {
    if (stereoRole) return new Set(prefix.map((asset) => asset.id));
    const timeClusters = clusterBursts(
      prefix.map(toDetectAsset),
      new Map<string, string>(),
      this.settings.burstOptions(),
    );
    return new Set(timeClusters.flatMap((c) => c.memberIds));
  }

  /** Stage 2 — hash/signature/aspect for each candidate that has none cached, and the caches to use. */
  private async hashCandidates(
    prefix: PhotoAsset[],
    candidateIds: ReadonlySet<string>,
  ): Promise<{
    hashed: number;
    hashes: Map<string, string>;
    signatures: Map<string, FrameSignature>;
    aspects: Map<string, number>;
  }> {
    const hashes = await this.hashes.getAll();
    const signatures = await this.signatures.getAll();
    const aspects = await this.aspects.getAll();
    const byId = new Map(prefix.map((a) => [a.id, a]));
    let hashed = 0;
    for (const id of candidateIds) {
      if (hashes.has(id) && signatures.has(id) && aspects.has(id)) continue;
      const asset = byId.get(id);
      if (!asset) continue;
      const { hash, signature, aspect } = await this.computeHashes(asset);
      await this.hashes.put(id, hash);
      hashes.set(id, hash);
      await this.signatures.put(id, signature);
      signatures.set(id, signature);
      await this.aspects.put(id, aspect);
      aspects.set(id, aspect);
      hashed++;
    }
    return { hashed, hashes, signatures, aspects };
  }

  /**
   * Stage 3 for an album marked as holding both eyes: every group is a **stereo set**, whichever
   * detector noticed it. No burst, no panorama — every frame in the album is an eye, so a group of
   * them is a pair or a multi-baseline set, and nothing else.
   *
   * The three clusterers are all asking "are these frames the same scene?" and differ only in where
   * they draw the line: stereo is the strictest on hash — parallax must not merge two scenes — and
   * adds a GPS guard, while a burst allows a looser hash with no distance check, and a pano matches
   * a lateral slide. A wide baseline makes exactly the pair they disagree about, a drone's most of
   * all: too much parallax for the stereo threshold, comfortably inside the burst one. Ranked by
   * precedence, as they are in an ordinary album, such a pair fell through to the burst detector and
   * reached review as "which is better, A or B?" — a duel between the two eyes of one photograph,
   * where the honest answer is neither, and where either verdict loses the other half for good.
   *
   * So here they are unioned rather than ranked, and overlapping clusters merged. The album's
   * marking is the ground truth about what its frames are; the detectors only disagree about a
   * threshold.
   */
  private stereoSets(
    albumId: string,
    prefix: PhotoAsset[],
    hashes: Map<string, string>,
    signatures: Map<string, FrameSignature>,
    aspects: Map<string, number>,
  ): DetectedGroup[] {
    // Only real captures pair: a derived/combined stereograph the user exported carries no camera
    // EXIF, and is a finished picture rather than an eye. It is held out of all three clusterers, not
    // just the stereo one — unioning them would otherwise let the looser burst threshold pull it into
    // a set that the stereo threshold had deliberately kept it out of.
    const captures = prefix.filter(isCaptureFrame);
    const found = [
      ...clusterStereo(captures.map(toStereoAsset), hashes, this.settings.stereoOptions()),
      ...clusterBursts(captures.map(toDetectAsset), hashes, this.settings.burstOptions()),
      ...clusterPanos(
        captures.map((a) => toPanoAsset(a, aspects.get(a.id))),
        signatures,
        hashes,
        this.settings.panoOptions(),
      ),
    ];
    return mergeOverlappingSets(found.map((cluster) => cluster.memberIds)).map(
      (memberIds): DetectedGroup => ({ type: 'stereo', sourceAlbumId: albumId, memberIds }),
    );
  }

  /** Stage 3 for an ordinary album: bursts confirmed by hash, then panos over what is left. */
  private mixedGroups(
    albumId: string,
    prefix: PhotoAsset[],
    hashes: Map<string, string>,
    signatures: Map<string, FrameSignature>,
    aspects: Map<string, number>,
  ): DetectedGroup[] {
    const burstGroups = clusterBursts(
      prefix.map(toDetectAsset),
      hashes,
      this.settings.burstOptions(),
    ).map((c): DetectedGroup => ({
      type: 'burst',
      sourceAlbumId: albumId,
      memberIds: c.memberIds,
    }));
    const claimed = new Set(burstGroups.flatMap((g) => g.memberIds));

    const panoAssets = prefix.map((a): PanoAsset => toPanoAsset(a, aspects.get(a.id)));
    const panoGroups = clusterPanos(panoAssets, signatures, hashes, this.settings.panoOptions())
      .filter((c) => !c.memberIds.some((id) => claimed.has(id)))
      .map((c): DetectedGroup => ({
        type: 'pano',
        sourceAlbumId: albumId,
        memberIds: c.memberIds,
        orientation: c.orientation,
      }));

    return [...burstGroups, ...panoGroups];
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

function takenOf(asset: PhotoAsset): string {
  return asset.payload?.captureDate ?? '';
}

/**
 * Whether two consecutive captures are close enough in time to belong to the same group — the rule the
 * scan window uses to finish a straddling burst/pano. A missing/unparseable timestamp counts as a
 * boundary (returns false), so the window stops rather than swallowing the rest of the album.
 */
function withinGap(a: PhotoAsset, b: PhotoAsset, gapMs: number): boolean {
  const ta = Date.parse(takenOf(a));
  const tb = Date.parse(takenOf(b));
  if (Number.isNaN(ta) || Number.isNaN(tb)) return false;
  return Math.abs(tb - ta) <= gapMs;
}

function toDetectAsset(asset: PhotoAsset): DetectAsset {
  return { id: asset.id, taken: asset.payload?.captureDate ?? '' };
}

function toPanoAsset(asset: PhotoAsset, aspect: number | undefined): PanoAsset {
  return { id: asset.id, taken: asset.payload?.captureDate ?? '', aspect };
}

function toStereoAsset(asset: PhotoAsset): StereoAsset {
  const loc = asset.payload?.location;
  return { id: asset.id, lat: loc?.latitude, lng: loc?.longitude };
}

function toAssetMeta(asset: PhotoAsset, albumId: string): AssetMeta {
  const { name, ext } = splitFileName(asset.payload?.importSource?.fileName ?? asset.id);
  const loc = asset.payload?.location;
  // Only attach GPS when both coordinates are present, so un-geotagged frames keep a clean meta shape.
  const gps =
    loc?.latitude !== undefined && loc.longitude !== undefined
      ? { lat: loc.latitude, lng: loc.longitude }
      : undefined;
  // Persist the body serial so the hydrator can assign twin-DSLR left/right without re-reading EXIF.
  const serial = cameraSerial(asset);
  return {
    albumId,
    name,
    ext,
    taken: asset.payload?.captureDate ?? '',
    ...gps,
    ...(serial && { serial }),
  };
}
