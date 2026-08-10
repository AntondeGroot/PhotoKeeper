import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { LightroomService } from '../../lightroom.service';
import { PhotoAsset } from '../../lightroom-types';
import { AssetMetaStore } from '../../storage/review/asset-meta-store';
import { GroupStore } from '../../storage/detection/group-store';
import { GroupOverrideStore, coversSameGroup } from '../../storage/detection/group-override-store';
import { AssetMeta } from '../../storage/photokeeper-db';
import { DetectedGroup } from '../../detection/detectors/detection-types';
import { ReviewItem } from '../../photo';
import { PreferencesService } from '../../preferences.service';
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
  private readonly prefs = inject(PreferencesService);

  async buildUnits(
    vacationAlbumIds: readonly string[],
    limit: number,
    rng: () => number = Math.random,
  ): Promise<ReviewItem[]> {
    const [albums, metaById, allGroups, dissolved, reclassified] = await Promise.all([
      firstValueFrom(this.svc.getAlbums()),
      this.meta.getAll(),
      this.groups.getAll(),
      this.overrides.getAll(),
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
      // Corrections follow the group they were made about even if re-detection shifted it by a
      // frame — see coversSameGroup. A dissolved group ("not a burst") is skipped; its members fall
      // through to singles below.
      if (dissolved.some((o) => coversSameGroup(o.memberIds, group.memberIds))) continue;
      // A reclassified group is re-typed before hydration ("this burst is actually a pano").
      const reclass = reclassified.find((r) => coversSameGroup(r.memberIds, group.memberIds));
      const effective = reclass
        ? { ...group, type: reclass.type, orientation: reclass.orientation }
        : group;
      pushInto(groupsByAlbum, group.sourceAlbumId, effective);
    }

    const leftSerialByAlbum = this.prefs.stereoLeftSerial();
    const albumIds = new Set([...assetsByAlbum.keys(), ...groupsByAlbum.keys()]);
    const albumUnits: AlbumUnits[] = [...albumIds].map((albumId) => {
      const name = albumName.get(albumId) ?? null;
      return {
        albumId,
        albumName: name,
        isVacation: vacation.has(albumId),
        assets: assetsByAlbum.get(albumId) ?? [],
        groups: groupsByAlbum.get(albumId) ?? [],
        // The body serial the user picked as the left eye for this stereo album (by name), if any.
        stereoLeftSerial: name ? leftSerialByAlbum[name] : undefined,
      };
    });

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
  // Rejoin name + ext into the original filename so hydration recovers both (it re-splits on the dot).
  const fileName = meta.ext ? `${meta.name}.${meta.ext}` : meta.name;
  // Restore GPS for geotagged frames so the stereo hydrator can rebuild baselines from displacement.
  const location =
    meta.lat !== undefined && meta.lng !== undefined
      ? { location: { latitude: meta.lat, longitude: meta.lng } }
      : undefined;
  // Restore the body serial so the hydrator can assign twin-DSLR left/right without re-reading EXIF.
  const camera = meta.serial ? { camera: { serial: meta.serial } } : undefined;
  return {
    id,
    subtype: 'image', // only images are stored as metadata
    payload: { captureDate: meta.taken, importSource: { fileName }, ...location, ...camera },
  };
}
