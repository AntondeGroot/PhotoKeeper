import { Injectable, inject, signal } from '@angular/core';
import { MergedPhoto, findMerges } from './merged-photo';
import { AssetMetaStore } from '../storage/review/asset-meta-store';
import { GroupStore } from '../storage/detection/group-store';
import { PhotoMergeStore } from '../storage/review/photo-merge-store';
import { ReviewStore } from '../storage/review/review-store';

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
  private readonly groups = inject(GroupStore);
  private readonly records = inject(PhotoMergeStore);

  /** Merges found and not yet settled. */
  readonly merges = signal<MergedPhoto[]>([]);

  /** The frames behind them — the photographs that need no further editing. */
  frameIds(): ReadonlySet<string> {
    return new Set(this.merges().flatMap((merge) => merge.frameIds));
  }

  async refresh(): Promise<void> {
    try {
      const [meta, verdicts, groups, settled] = await Promise.all([
        this.meta.getAll(),
        this.reviews.getVerdicts(),
        this.groups.getAll(),
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
