import { Injectable, inject } from '@angular/core';
import { AssetMetaStore } from '../storage/review/asset-meta-store';
import { GroupStore } from '../storage/detection/group-store';
import { ReviewStore } from '../storage/review/review-store';
import { AssetMeta } from '../storage/photokeeper-db';
import { AlbumAsset, NEIGHBOURS_EACH_SIDE, PanoCandidate, candidateWindow } from './pano-frames';

/**
 * Finds the photos to offer when a panorama is missing frames.
 *
 * Reads the same on-device metadata index the daily selection is built from, so the neighbourhood is
 * available with no network call at all — which matters because this opens mid-review, in front of
 * someone who is part-way through a decision.
 */
@Injectable({ providedIn: 'root' })
export class PanoFramesService {
  private readonly meta = inject(AssetMetaStore);
  private readonly groups = inject(GroupStore);
  private readonly reviews = inject(ReviewStore);

  /**
   * The photos around `frameIds`, in capture order, including those frames themselves.
   *
   * Takes the frames rather than the pano they came from, because a lone photograph asks this too:
   * one frame of a grid-pattern sweep can be the only thing detection found, and it needs the same
   * neighbourhood offered to it. Nothing here ever needed more than the ids.
   *
   * The album comes from the frames rather than from any unit's own `album`, which holds a display
   * name: several albums can share a name, and the frames say exactly which one they came out of.
   */
  async candidatesFor(frameIds: readonly string[]): Promise<PanoCandidate[]> {
    const [metaById, verdicts] = await Promise.all([
      this.meta.getAll(),
      this.reviews.getVerdicts(),
    ]);
    const albumId = frameIds.map((id) => metaById.get(id)?.albumId).find((id) => id !== undefined);
    if (albumId === undefined) return [];

    const mine = new Set(frameIds);
    /**
     * A photograph is offered only if nothing has been said about it yet — or if it is already one
     * of these frames, which is the one decided thing that belongs here.
     *
     * Anything else has been answered for: kept, sent to edit, or rejected and by now very likely
     * deleted in Lightroom, which is the same condition seen later. Offering those invites a
     * panorama built out of photographs that no longer exist, and quietly re-opens a decision the
     * user made deliberately somewhere else.
     */
    const offerable = (id: string): boolean =>
      mine.has(id) || (verdicts.get(id)?.status ?? 'backlog') === 'backlog';

    const assets: AlbumAsset[] = [];
    for (const [id, meta] of metaById) {
      if (meta.albumId === albumId && offerable(id)) assets.push(toAlbumAsset(id, meta));
    }
    // The album's other detected groups, so the window can hold a sibling sweep whole — a panorama
    // split into two by detection is exactly what this picker is asked to put back together. One
    // whose photographs have been decided is not on offer either, whole or in part.
    const otherGroups = (await this.groups.getByAlbum(albumId))
      .map((group) => group.memberIds)
      .filter((members) => !members.some((id) => mine.has(id)) && members.every(offerable));

    return candidateWindow(frameIds, assets, NEIGHBOURS_EACH_SIDE, otherGroups);
  }
}

function toAlbumAsset(id: string, meta: AssetMeta): AlbumAsset {
  return { id, name: meta.name, ext: meta.ext, taken: meta.taken };
}
