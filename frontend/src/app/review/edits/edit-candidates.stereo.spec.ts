import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { FrameSignature } from '../../detection/detectors/detection-types';
import { SIGNATURE_SIZE } from '../../detection/detectors/phash';
import { KeeperAlbumsService } from '../../keeper-albums.service';
import { PreferencesService } from '../../preferences.service';
import { GroupOverrideStore } from '../../storage/detection/group-override-store';
import { GroupStore } from '../../storage/detection/group-store';
import { SignatureStore } from '../../storage/detection/signature-store';
import { AssetMeta, FiledRecord, StoredVerdict } from '../../storage/photokeeper-db';
import { AssetMetaStore } from '../../storage/review/asset-meta-store';
import { KeeperFilingStore } from '../../storage/review/keeper-filing-store';
import { ReviewStore } from '../../storage/review/review-store';
import { EditCandidatesService } from './edit-candidates.service';
import { MergeFinderService } from './merge-finder.service';

/**
 * A frame's signature: noise keyed on the shot, so different shots do not match, with the second eye
 * being the same picture shifted a few columns, which is what makes the two a pair.
 */
function signatureOf(shot: number, shift = 0): FrameSignature {
  const out = new Uint8Array(SIGNATURE_SIZE * SIGNATURE_SIZE);
  for (let y = 0; y < SIGNATURE_SIZE; y++) {
    for (let x = 0; x < SIGNATURE_SIZE; x++) {
      const scene = x + shift;
      let h =
        (Math.imul(shot, 73856093) ^ Math.imul(scene, 19349663) ^ Math.imul(y, 83492791)) >>> 0;
      h = Math.imul(h ^ (h >>> 13), 2654435761) >>> 0;
      out[y * SIGNATURE_SIZE + x] = (h ^ (h >>> 16)) & 0xff;
    }
  }
  return out;
}

describe('EditCandidatesService, with a stereo shoot split across two albums', () => {
  /**
   * These pairs are never stored, so only rebuilding them can tell the Edit tab two photographs in
   * two albums are one shot. Run through the real pairing, because that is the thing that could fail
   * to agree with the deck. A frame nothing matched has no pair to join, so it stays its own row.
   */
  it('puts both eyes of a pair on one row, leaving an unmatched frame on its own', async () => {
    const frame = (albumId: string, name: string): AssetMeta => ({
      albumId,
      name,
      ext: 'CR2',
      taken: '2026-06-14T10:00:00Z',
    });
    const meta = new Map<string, AssetMeta>([
      ['L1', frame('alb-left', 'L1')],
      ['lone', frame('alb-left', 'lone')],
      ['R1', frame('alb-right', 'R1')],
    ]);
    const toEdit: StoredVerdict = { status: 'toEdit', starred: false, saveOnly: false };
    const verdicts = new Map([...meta.keys()].map((id) => [id, toEdit]));
    const filed = new Map<string, FiledRecord>([
      ['L1', { albums: ['KeeperEdit'], at: 100 }],
      ['R1', { albums: ['KeeperEdit'], at: 200 }],
      ['lone', { albums: ['KeeperEdit'], at: 300 }],
    ]);
    const signatures = new Map<string, FrameSignature>([
      ['L1', signatureOf(1)],
      ['R1', signatureOf(1, 4)],
      ['lone', signatureOf(2)],
    ]);
    const albumIds: Record<string, string> = { Left: 'alb-left', Right: 'alb-right' };
    TestBed.configureTestingModule({
      providers: [
        { provide: ReviewStore, useValue: { getVerdicts: () => Promise.resolve(verdicts) } },
        { provide: AssetMetaStore, useValue: { getAll: () => Promise.resolve(meta) } },
        { provide: KeeperFilingStore, useValue: { getAll: () => Promise.resolve(filed) } },
        { provide: SignatureStore, useValue: { getAll: () => Promise.resolve(signatures) } },
        { provide: GroupStore, useValue: { getAll: () => Promise.resolve([]) } },
        {
          provide: GroupOverrideStore,
          useValue: {
            getAll: () => Promise.resolve([]),
            reclassifications: () => Promise.resolve([]),
            memberships: () => Promise.resolve([]),
          },
        },
        {
          provide: MergeFinderService,
          useValue: {
            merges: signal([]),
            frameIds: () => new Set(),
            refresh: () => Promise.resolve(),
          },
        },
        {
          provide: PreferencesService,
          useValue: {
            editGoal: () => 5,
            stereoAlbumRoles: () => ({ Left: 'left', Right: 'right' }),
            stereoPartners: () => ({ Left: 'Right' }),
          },
        },
        {
          provide: KeeperAlbumsService,
          useValue: {
            nameFor: (id: string) => (id === 'alb-left' ? 'Left' : 'Right'),
            idFor: (name: string) => albumIds[name] ?? null,
            checked: () => false,
          },
        },
      ],
    });
    const service = TestBed.inject(EditCandidatesService);

    await service.refresh();

    expect(service.all().map((row) => [row.id, row.setKind, row.setFrameIds])).toEqual([
      ['L1', 'stereo', ['L1', 'R1']],
      ['lone', undefined, undefined],
    ]);
  });
});
