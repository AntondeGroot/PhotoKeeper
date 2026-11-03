import { TestBed } from '@angular/core/testing';
import { DetectedGroup } from '../../../detection/detectors/detection-types';
import { KeeperAlbumsService } from '../../../keeper-albums.service';
import { PreferencesService } from '../../../preferences.service';
import { GroupOverrideStore } from '../../../storage/detection/group-override-store';
import { GroupStore } from '../../../storage/detection/group-store';
import { SignatureStore } from '../../../storage/detection/signature-store';
import { AssetMetaStore } from '../../../storage/review/asset-meta-store';
import { CorrectedGroupsService } from './corrected-groups.service';

describe('CorrectedGroupsService', () => {
  /**
   * Marking an album as stereo takes effect at once on the deck, but its stored groups stay as they
   * were until the next scan. A pair the burst detector had claimed would reach the Edit tab as a
   * burst, and "Done editing" would go looking for an HDR that will never exist. Other albums' bursts
   * must stay bursts.
   */
  it('treats a burst in an album marked as both eyes as a stereo pair', async () => {
    const stored: DetectedGroup[] = [
      { type: 'burst', sourceAlbumId: 'alb-stereo', memberIds: ['left', 'right'] },
      { type: 'burst', sourceAlbumId: 'alb-plain', memberIds: ['s1', 's2'] },
    ];
    TestBed.configureTestingModule({
      providers: [
        { provide: GroupStore, useValue: { getAll: () => Promise.resolve(stored) } },
        {
          provide: GroupOverrideStore,
          useValue: {
            getAll: () => Promise.resolve([]),
            reclassifications: () => Promise.resolve([]),
            memberships: () => Promise.resolve([]),
          },
        },
        { provide: AssetMetaStore, useValue: { getAll: () => Promise.resolve(new Map()) } },
        {
          provide: PreferencesService,
          useValue: {
            stereoAlbumRoles: () => ({ '3D Trip': 'both', 'Holiday': 'left' }),
            stereoPartners: () => ({}),
          },
        },
        {
          provide: KeeperAlbumsService,
          useValue: {
            nameFor: (id: string) => (id === 'alb-stereo' ? '3D Trip' : 'Holiday'),
            idFor: () => null,
          },
        },
        { provide: SignatureStore, useValue: { getAll: () => Promise.resolve(new Map()) } },
      ],
    });

    const groups = await TestBed.inject(CorrectedGroupsService).all();

    expect(groups.map((group) => [group.sourceAlbumId, group.type])).toEqual([
      ['alb-stereo', 'stereo'],
      ['alb-plain', 'burst'],
    ]);
  });
});
