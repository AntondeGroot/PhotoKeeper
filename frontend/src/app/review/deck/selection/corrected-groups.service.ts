import { Injectable, inject } from '@angular/core';
import { DetectedGroup } from '../../../detection/detectors/detection-types';
import { DetectionSettingsService } from '../../../detection/scan/detection-settings.service';
import { PhotoAsset } from '../../../lightroom-types';
import { AssetMeta } from '../../../storage/photokeeper-db';
import { SignatureStore } from '../../../storage/detection/signature-store';
import { KeeperAlbumsService } from '../../../keeper-albums.service';
import { PreferencesService } from '../../../preferences.service';
import { AssetMetaStore } from '../../../storage/review/asset-meta-store';
import { GroupOverrideStore } from '../../../storage/detection/group-override-store';
import { GroupStore } from '../../../storage/detection/group-store';
import { toPhotoAsset } from './daily-units.service';
import { correctedGroups } from './group-corrections';
import { pairStereoAlbums } from './stereo-pairing';

/**
 * The groups as the user has said they are, for anything outside the deck that asks.
 *
 * Detection's own answer is not good enough once someone has corrected it: a frame added to a sweep
 * by hand is part of that panorama, and only the correction says so.
 */
@Injectable({ providedIn: 'root' })
export class CorrectedGroupsService {
  private readonly groups = inject(GroupStore);
  private readonly overrides = inject(GroupOverrideStore);
  private readonly meta = inject(AssetMetaStore);
  private readonly prefs = inject(PreferencesService);
  private readonly albums = inject(KeeperAlbumsService);
  private readonly signatures = inject(SignatureStore);
  private readonly settings = inject(DetectionSettingsService);

  async all(): Promise<DetectedGroup[]> {
    const [groups, dissolved, reclassified, memberships, meta] = await Promise.all([
      this.groups.getAll(),
      this.overrides.getAll(),
      this.overrides.reclassifications(),
      this.overrides.memberships(),
      this.meta.getAll(),
    ]);
    const { detected, asserted } = correctedGroups(
      groups,
      { dissolved, reclassified, memberships },
      meta,
    );
    // The same rule the deck applies: marking an album takes effect at once, while its stored groups
    // stay as they were until the next scan. An album whose name is not known yet stays as stored.
    const roles = this.prefs.stereoAlbumRoles();
    const isBothEyes = (albumId: string): boolean =>
      roles[this.albums.nameFor(albumId) ?? ''] === 'both';
    const stored = [
      ...detected.map((group) =>
        isBothEyes(group.sourceAlbumId) ? { ...group, type: 'stereo' as const } : group,
      ),
      ...asserted,
    ];
    return [...stored, ...(await this.splitAlbumPairs(stored, meta))];
  }

  /**
   * The stereo pairs of a shoot split across two albums, which are never stored: the deck rebuilds
   * them whenever it builds a queue, so the same rule is applied here. Only the pairs are taken, since
   * what becomes of an unpaired frame is the deck's business. Costs a read of every signature, so
   * only when an album is actually marked as one half of a split.
   */
  private async splitAlbumPairs(
    stored: readonly DetectedGroup[],
    meta: ReadonlyMap<string, AssetMeta>,
  ): Promise<DetectedGroup[]> {
    const roles = this.prefs.stereoAlbumRoles();
    if (!Object.values(roles).some((role) => role === 'left' || role === 'right')) return [];

    const partners = this.prefs.stereoPartners();
    const albumIdByName = new Map<string, string>();
    for (const name of [...Object.keys(roles), ...Object.values(partners)]) {
      const albumId = this.albums.idFor(name);
      if (albumId) albumIdByName.set(name, albumId);
    }
    const assetsByAlbum = new Map<string, PhotoAsset[]>();
    for (const [id, asset] of meta) {
      assetsByAlbum.set(asset.albumId, [
        ...(assetsByAlbum.get(asset.albumId) ?? []),
        toPhotoAsset(id, asset),
      ]);
    }
    const pairing = pairStereoAlbums({
      roles,
      partners,
      albumIdByName,
      assetsByAlbum,
      signatures: await this.signatures.getAll(),
      groupedIds: new Set(stored.flatMap((group) => group.memberIds)),
      fullyScanned: new Set(),
      options: this.settings.eyePairOptions(),
    });
    return [...pairing.groups.values()].flat();
  }
}
