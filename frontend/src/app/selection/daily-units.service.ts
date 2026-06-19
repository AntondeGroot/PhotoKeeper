import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { LightroomService, PhotoAsset } from '../lightroom.service';
import { AssetMetaStore } from '../storage/asset-meta-store';
import { GroupStore } from '../storage/group-store';
import { GroupOverrideStore, groupSignature } from '../storage/group-override-store';
import { AssetMeta, DetectedGroup } from '../storage/photokeeper-db';
import { ReviewItem } from '../photo';
import { AlbumUnits, selectUnits } from './unit-selection';

/**
 * Builds the daily review queue entirely on-device: reads the metadata + detected groups the
 * background scan stored, assembles them into per-album units, and samples with {@link selectUnits}.
 * No album-list re-fetch — only the cheap album-name lookup (`getAlbums`) hits the network. Falls to
 * an empty queue when nothing has been scanned yet (the caller handles that cold-start case).
 */
@Injectable({ providedIn: 'root' })
export class DailyUnitsService {
  private readonly svc = inject(LightroomService);
  private readonly meta = inject(AssetMetaStore);
  private readonly groups = inject(GroupStore);
  private readonly overrides = inject(GroupOverrideStore);

  async buildUnits(
    vacationAlbumIds: readonly string[],
    limit: number,
    rng: () => number = Math.random,
  ): Promise<ReviewItem[]> {
    const [albums, metaById, allGroups, dissolved, reclassified] = await Promise.all([
      firstValueFrom(this.svc.getAlbums()),
      this.meta.getAll(),
      this.groups.getAll(),
      this.overrides.signatures(),
      this.overrides.reclassifications(),
    ]);

    const albumName = new Map(albums.map((a) => [a.id, a.name]));
    const vacation = new Set(vacationAlbumIds);

    const assetsByAlbum = new Map<string, PhotoAsset[]>();
    for (const [id, meta] of metaById) {
      pushInto(assetsByAlbum, meta.albumId, toPhotoAsset(id, meta));
    }
    const groupsByAlbum = new Map<string, DetectedGroup[]>();
    for (const group of allGroups) {
      const sig = groupSignature(group.memberIds);
      // A dissolved group ("not a burst") is skipped — its members fall through to singles below.
      if (dissolved.has(sig)) continue;
      // A reclassified group is re-typed before hydration ("this burst is actually a pano").
      const reclass = reclassified.get(sig);
      const effective = reclass
        ? { ...group, type: reclass.type, orientation: reclass.orientation }
        : group;
      pushInto(groupsByAlbum, group.sourceAlbumId, effective);
    }

    const albumIds = new Set([...assetsByAlbum.keys(), ...groupsByAlbum.keys()]);
    const albumUnits: AlbumUnits[] = [...albumIds].map((albumId) => ({
      albumId,
      albumName: albumName.get(albumId) ?? null,
      isVacation: vacation.has(albumId),
      assets: assetsByAlbum.get(albumId) ?? [],
      groups: groupsByAlbum.get(albumId) ?? [],
    }));

    return selectUnits(albumUnits, limit, rng);
  }
}

function pushInto<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key) ?? [];
  list.push(value);
  map.set(key, list);
}

/** Reconstructs the minimal {@link PhotoAsset} shape `selectUnits` hydrates from, out of stored meta. */
function toPhotoAsset(id: string, meta: AssetMeta): PhotoAsset {
  return {
    id,
    subtype: 'image', // only images are stored as metadata
    payload: { captureDate: meta.taken, importSource: { fileName: meta.name } },
  };
}
