import { Injectable, inject } from '@angular/core';
import { AssetMetaStore } from '../storage/review/asset-meta-store';
import { GroupStore } from '../storage/detection/group-store';
import { AssetMeta } from '../storage/photokeeper-db';
import { Pano } from '../photo';
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

  /**
   * The photos around `pano`'s frames, in capture order, including the frames themselves.
   *
   * The album comes from the frames rather than from the pano's own `album`, which holds a display
   * name: several albums can share a name, and the frames say exactly which one they came out of.
   */
  async candidatesFor(pano: Pano): Promise<PanoCandidate[]> {
    const metaById = await this.meta.getAll();
    const frameIds = pano.frames.map((frame) => frame.id);
    const albumId = frameIds.map((id) => metaById.get(id)?.albumId).find((id) => id !== undefined);
    if (albumId === undefined) return [];

    const assets: AlbumAsset[] = [];
    for (const [id, meta] of metaById) {
      if (meta.albumId === albumId) assets.push(toAlbumAsset(id, meta));
    }
    // The album's other detected groups, so the window can hold a sibling sweep whole — a panorama
    // split into two by detection is exactly what this picker is asked to put back together.
    const mine = new Set(frameIds);
    const otherGroups = (await this.groups.getByAlbum(albumId))
      .map((group) => group.memberIds)
      .filter((members) => !members.some((id) => mine.has(id)));

    return candidateWindow(frameIds, assets, NEIGHBOURS_EACH_SIDE, otherGroups);
  }
}

function toAlbumAsset(id: string, meta: AssetMeta): AlbumAsset {
  return { id, name: meta.name, ext: meta.ext, taken: meta.taken };
}
