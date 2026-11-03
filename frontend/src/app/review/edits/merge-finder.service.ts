import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { toAssetMeta } from '../../detection/scan/detection-scan.service';
import { PhotoAsset } from '../../lightroom-types';
import { LightroomService } from '../../lightroom.service';
import { MergedPhoto, findMerges, mergeKind, mergeSourceNames } from './merged-photo';
import { AssetMetaStore } from '../../storage/review/asset-meta-store';
import { CorrectedGroupsService } from '../deck/selection/corrected-groups.service';
import { PhotoMergeStore } from '../../storage/review/photo-merge-store';
import { ReviewStore } from '../../storage/review/review-store';

/**
 * Which sets Lightroom has already merged into one photograph, and which frames they came from.
 *
 * Its own service because three different things need the answer and none of them owns it: the Edit
 * tab must not offer a sweep that has already been stitched, the filing must not hold the album shut
 * waiting for work that is finished, and the check offers the merge for confirming. Computed once,
 * from what the scan has stored, so it costs nothing and needs no network.
 */
@Injectable({ providedIn: 'root' })
export class MergeFinderService {
  private readonly meta = inject(AssetMetaStore);
  private readonly reviews = inject(ReviewStore);
  private readonly groups = inject(CorrectedGroupsService);
  private readonly records = inject(PhotoMergeStore);
  private readonly svc = inject(LightroomService);

  /** Merges found and not yet settled. */
  readonly merges = signal<MergedPhoto[]>([]);

  /** The frames behind them — the photographs that need no further editing. */
  frameIds(): ReadonlySet<string> {
    return new Set(this.merges().flatMap((merge) => merge.frameIds));
  }

  /**
   * Asks Lightroom whether these frames have been merged, without waiting for the scan to get there.
   *
   * Reads the albums the frames came from, because that is where Lightroom puts the merged file.
   * Rejects when an album cannot be read: "could not look" must not be mistaken for "not there".
   */
  async searchFor(frameIds: readonly string[]): Promise<MergedPhoto[]> {
    const known = await this.meta.getAll();
    const albumIds = new Set(frameIds.flatMap((id) => known.get(id)?.albumId ?? []));
    for (const albumId of albumIds) {
      const assets = await firstValueFrom(this.svc.getAllAlbumAssets(albumId));
      await this.forgetDeletedMerges(assets, known);
      await this.rememberMerges(assets, albumId, known);
    }
    await this.refresh();
    const wanted = new Set(frameIds);
    return this.merges().filter((merge) => merge.frameIds.some((id) => wanted.has(id)));
  }

  /**
   * Drops the record of a merged file that has since been deleted, without waiting for the next scan.
   *
   * Goes by tombstones rather than by what is missing from the listing, because a listing can stop
   * short on a very large album, and that must not cost a real file its record. The scan handles any
   * other photograph, and only a merged file can be confirmed in place of its frames.
   */
  private async forgetDeletedMerges(
    assets: readonly PhotoAsset[],
    known: ReadonlyMap<string, { name: string }>,
  ): Promise<void> {
    for (const asset of assets) {
      const deletedId = asset.subtype === 'deleted_image' ? asset.original?.id : undefined;
      const name = deletedId ? known.get(deletedId)?.name : undefined;
      if (deletedId && name && mergeKind(name) !== null) await this.meta.delete(deletedId);
    }
  }

  /** Stores just what recognising a merge needs: merged files, and the sources they are named after. */
  private async rememberMerges(
    assets: readonly PhotoAsset[],
    albumId: string,
    known: ReadonlyMap<string, unknown>,
  ): Promise<void> {
    // Photographs only, as the scan reads them. A deleted file's tombstone keeps its filename, and a
    // merge thrown away is not a merge.
    const fresh = assets
      .filter((asset) => asset.subtype === 'image' && !known.has(asset.id))
      .map((asset) => ({ id: asset.id, meta: toAssetMeta(asset, albumId) }));
    const merged = fresh.filter((file) => mergeKind(file.meta.name) !== null);
    const sources = new Set(
      merged.flatMap((file) => mergeSourceNames(file.meta.name).map((name) => name.toLowerCase())),
    );
    for (const file of fresh) {
      if (mergeKind(file.meta.name) !== null || sources.has(file.meta.name.toLowerCase())) {
        await this.meta.put(file.id, file.meta);
      }
    }
  }

  async refresh(): Promise<void> {
    try {
      const [meta, verdicts, groups, settled] = await Promise.all([
        this.meta.getAll(),
        this.reviews.getVerdicts(),
        this.groups.all(),
        this.records.getAll(),
      ]);

      // Any kind of group: a sweep arrives as a pano, while the brackets an HDR is merged from are
      // near-identical frames seconds apart — which is a burst.
      const setOf = new Map<string, string[]>();
      for (const group of groups) {
        for (const frameId of group.memberIds) setOf.set(frameId, group.memberIds);
      }

      const found = findMerges(
        [...meta].map(([id, asset]) => ({ id, name: asset.name })),
        (assetId) => verdicts.get(assetId)?.status === 'toEdit',
        (assetId) => setOf.get(assetId),
      );
      this.merges.set(found.filter((merge) => !settled.has(merge.mergedId)));
    } catch {
      // Storage unavailable: leave what was found last time rather than claiming nothing is merged.
    }
  }
}
