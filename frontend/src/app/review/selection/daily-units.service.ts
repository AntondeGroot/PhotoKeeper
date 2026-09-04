import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { LightroomService } from '../../lightroom.service';
import { PhotoAsset } from '../../lightroom-types';
import { AssetMetaStore } from '../../storage/review/asset-meta-store';
import { GroupStore } from '../../storage/detection/group-store';
import { AlbumManifestStore, isFullyScanned } from '../../storage/detection/album-manifest-store';
import { SignatureStore } from '../../storage/detection/signature-store';
import { GroupOverrideStore, coversSameGroup } from '../../storage/detection/group-override-store';
import { AssetMeta } from '../../storage/photokeeper-db';
import { DetectedGroup, PanoOrientation } from '../../detection/detectors/detection-types';
import { ReviewItem } from '../../photo';
import { PreferencesService } from '../../preferences.service';
import { DetectionSettingsService } from '../../detection/scan/detection-settings.service';
import { AlbumUnits, selectUnits } from './unit-selection';
import { pairStereoAlbums } from './stereo-pairing';

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
  private readonly manifests = inject(AlbumManifestStore);
  private readonly signatures = inject(SignatureStore);
  private readonly overrides = inject(GroupOverrideStore);
  private readonly prefs = inject(PreferencesService);
  private readonly settings = inject(DetectionSettingsService);

  async buildUnits(
    vacationAlbumIds: readonly string[],
    limit: number,
    rng: () => number = Math.random,
  ): Promise<ReviewItem[]> {
    const [
      albums,
      metaById,
      allGroups,
      dissolved,
      reclassified,
      memberships,
      manifests,
      signatures,
    ] = await Promise.all([
      firstValueFrom(this.svc.getAlbums()),
      this.meta.getAll(),
      this.groups.getAll(),
      this.overrides.getAll(),
      this.overrides.reclassifications(),
      this.overrides.memberships(),
      this.manifests.getAll(),
      this.signatures.getAll(),
    ]);

    const albumName = new Map(albums.map((a) => [a.id, a.name]));
    const vacation = new Set(vacationAlbumIds);

    const assetsByAlbum = new Map<string, PhotoAsset[]>();
    for (const [id, meta] of metaById) {
      pushInto(assetsByAlbum, meta.albumId, toPhotoAsset(id, meta));
    }
    const roles = this.prefs.stereoAlbumRoles();
    const bothEyeAlbumIds = new Set(
      albums.filter((album) => roles[album.name] === 'both').map((album) => album.id),
    );
    const groupsByAlbum = this.groupsByAlbum(
      allGroups,
      { dissolved, reclassified, memberships },
      bothEyeAlbumIds,
    );

    // What every stereo marking means for selection: a split shoot's two albums matched back into
    // pairs, and every frame that has no other eye named as the half it is (see stereo-pairing.ts).
    // Pairing is rebuilt per queue rather than stored — the rule is known up front.
    const split = pairStereoAlbums({
      roles,
      partners: this.prefs.stereoPartners(),
      albumIdByName: new Map(albums.map((a) => [a.name, a.id])),
      assetsByAlbum,
      signatures,
      groupedIds: new Set([...groupsByAlbum.values()].flat().flatMap((g) => g.memberIds)),
      options: this.settings.eyePairOptions(),
      // Only an album scanned to the end can be said to be missing an eye rather than merely
      // still being read.
      fullyScanned: new Set(
        [...manifests].filter(([, m]) => isFullyScanned(m)).map(([albumId]) => albumId),
      ),
    });

    const leftSerialByAlbum = this.prefs.stereoLeftSerial();
    const albumIds = new Set([...assetsByAlbum.keys(), ...groupsByAlbum.keys()]);
    const albumUnits: AlbumUnits[] = [...albumIds]
      // A right-eye album never stands on its own: its frames are halves, and the pairs that use
      // them are offered by the left album instead.
      .filter((albumId) => !split.hiddenAlbumIds.has(albumId))
      .map((albumId) => {
        const name = albumName.get(albumId) ?? null;
        return {
          albumId,
          albumName: name,
          isVacation: vacation.has(albumId),
          // Withheld frames are halves whose other eye may simply not have been scanned yet: off
          // the deck until the scan can say, rather than offered as anything.
          assets: [
            ...(assetsByAlbum.get(albumId) ?? []),
            ...(split.extraAssets.get(albumId) ?? []),
          ].filter((asset) => !split.withheldIds.has(asset.id)),
          groups: [...(groupsByAlbum.get(albumId) ?? []), ...(split.groups.get(albumId) ?? [])],
          // The body serial the user picked as the left eye for this stereo album (by name), if any.
          stereoLeftSerial: name ? leftSerialByAlbum[name] : undefined,
          stereoLeftEyeIds: split.leftEyeIds,
          // Frames of a stereo album with no other eye: shown as incomplete pairs, never as photos.
          stereoGaps: split.gaps,
        };
      });

    return selectUnits(albumUnits, limit, rng);
  }

  /**
   * The detected groups per album, with every user correction applied — and with a stereo album's
   * groups re-typed to stereo whatever detection called them.
   *
   * That last part is the same rule the scan applies (see DetectionScanService.stereoSets), repeated
   * here so that marking an album takes effect on the deck at once. Marking drops the album's
   * manifest, but the groups already stored stay as they are until the next scan actually runs, and
   * until then a stereo pair the burst detector had claimed would keep arriving as "which is better,
   * A or B?" — a duel between the two eyes of one photograph.
   */
  private groupsByAlbum(
    allGroups: readonly DetectedGroup[],
    corrections: GroupCorrections,
    bothEyeAlbumIds: ReadonlySet<string>,
  ): Map<string, DetectedGroup[]> {
    const byAlbum = new Map<string, DetectedGroup[]>();
    for (const group of allGroups) {
      const corrected = applyCorrections(group, corrections);
      if (!corrected) continue;
      const effective = bothEyeAlbumIds.has(group.sourceAlbumId)
        ? { ...corrected, type: 'stereo' as const }
        : corrected;
      pushInto(byAlbum, group.sourceAlbumId, effective);
    }
    return byAlbum;
  }
}

/** The three kinds of user correction a stored group can carry. */
interface GroupCorrections {
  dissolved: { memberIds: string[] }[];
  reclassified: {
    memberIds: string[];
    type: DetectedGroup['type'];
    orientation?: PanoOrientation;
  }[];
  memberships: { memberIds: string[]; frameIds: string[] }[];
}

/**
 * One stored group as the user has corrected it, or null when they dissolved it.
 *
 * Corrections follow the group they were made about even if re-detection shifted it by a frame — see
 * coversSameGroup. A dissolved group ("not a burst") drops out entirely; its members fall through to
 * singles.
 */
function applyCorrections(
  group: DetectedGroup,
  { dissolved, reclassified, memberships }: GroupCorrections,
): DetectedGroup | null {
  if (dissolved.some((o) => coversSameGroup(o.memberIds, group.memberIds))) return null;
  // A reclassified group is re-typed before hydration ("this burst is actually a pano").
  const reclass = reclassified.find((r) => coversSameGroup(r.memberIds, group.memberIds));
  const retyped = reclass
    ? { ...group, type: reclass.type, orientation: reclass.orientation }
    : group;
  // A membership correction says what the group actually consists of ("the pano is missing frames").
  // Applied last, and to the *detected* member set: it is keyed by what detection found, so
  // re-running detection finds the same correction again.
  const members = memberships.find((m) => coversSameGroup(m.memberIds, group.memberIds));
  return members ? { ...retyped, memberIds: members.frameIds } : retyped;
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
