import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { DailyUnitsService } from './daily-units.service';
import { AssetMetaStore } from '../../storage/review/asset-meta-store';
import { GroupStore } from '../../storage/detection/group-store';
import { GroupOverrideStore } from '../../storage/detection/group-override-store';
import { AlbumManifestStore } from '../../storage/detection/album-manifest-store';
import { PreferencesService } from '../../preferences.service';
import { Album, LightroomService } from '../../lightroom.service';
import { Burst, ReviewItem, Stereo } from '../../photo';

const fixedRng = () => 0;

const idsOf = (unit: ReviewItem): string[] =>
  unit.kind === 'burst' ? unit.photos.map((p) => p.id) : [unit.id];

describe('DailyUnitsService', () => {
  let service: DailyUnitsService;
  let metaStore: AssetMetaStore;
  let groupStore: GroupStore;
  let overrideStore: GroupOverrideStore;
  let manifestStore: AlbumManifestStore;
  let prefs: PreferencesService;
  let albums: Album[];

  beforeEach(() => {
    indexedDB = new IDBFactory(); // fresh, empty database per test
    albums = [];
    TestBed.configureTestingModule({
      providers: [{ provide: LightroomService, useValue: { getAlbums: () => of(albums) } }],
    });
    service = TestBed.inject(DailyUnitsService);
    metaStore = TestBed.inject(AssetMetaStore);
    groupStore = TestBed.inject(GroupStore);
    overrideStore = TestBed.inject(GroupOverrideStore);
    manifestStore = TestBed.inject(AlbumManifestStore);
    prefs = TestBed.inject(PreferencesService);
  });

  /**
   * A both-eyes album of three frames, two of which detection paired. `scanned` is how far the
   * incremental scan has reached — the only thing that says whether "a3 paired with nothing" is a
   * fact about the album or just about how much of it has been read.
   */
  async function bothEyeAlbumScannedTo(scanned: number): Promise<void> {
    albums = [{ id: 'alb-1', name: 'Field work' }];
    prefs.stereoAlbumRoles.set({ 'Field work': 'both' });
    const ids = ['a1', 'a2', 'a3'];
    for (const [i, id] of ids.entries()) {
      await metaStore.put(id, {
        albumId: 'alb-1',
        name: `DSC_${id}`,
        taken: `2026-05-01T10:0${i}:00Z`,
      });
    }
    await groupStore.replaceForAlbum('alb-1', [
      { type: 'stereo', sourceAlbumId: 'alb-1', memberIds: ['a1', 'a2'] },
    ]);
    await manifestStore.record(
      'alb-1',
      ids.map((id) => ({ id })),
      scanned,
    );
  }

  it('builds an empty queue when nothing has been scanned', async () => {
    expect(await service.buildUnits([], 10, fixedRng)).toEqual([]);
  });

  it('assembles a detected burst and a single from stored metadata, with album names', async () => {
    albums = [{ id: 'alb-1', name: 'Lisbon' }];
    await metaStore.put('a1', { albumId: 'alb-1', name: 'IMG_1', taken: '2026-05-01T10:00:00Z' });
    await metaStore.put('a2', { albumId: 'alb-1', name: 'IMG_2', taken: '2026-05-01T10:00:02Z' });
    await metaStore.put('a3', { albumId: 'alb-1', name: 'IMG_3', taken: '2026-05-01T12:00:00Z' });
    await groupStore.replaceForAlbum('alb-1', [
      { type: 'burst', sourceAlbumId: 'alb-1', memberIds: ['a1', 'a2'] },
    ]);

    const units = await service.buildUnits([], 10, fixedRng);

    expect(units).toHaveLength(2);
    const burst = units.find((u): u is Burst => u.kind === 'burst');
    expect(burst?.photos.map((p) => p.id)).toEqual(['a1', 'a2']);
    expect(burst?.album).toBe('Lisbon');
    expect(burst?.name).toBe('Burst · 2 frames');
    const single = units.find((u) => u.kind === 'photo');
    expect(single).toMatchObject({ id: 'a3', name: 'IMG_3', album: 'Lisbon' });
  });

  it('drops a dissolved group so its members become singles', async () => {
    albums = [{ id: 'alb-1', name: 'Lisbon' }];
    await metaStore.put('a1', { albumId: 'alb-1', name: 'IMG_1', taken: '2026-05-01T10:00:00Z' });
    await metaStore.put('a2', { albumId: 'alb-1', name: 'IMG_2', taken: '2026-05-01T10:00:02Z' });
    await groupStore.replaceForAlbum('alb-1', [
      { type: 'burst', sourceAlbumId: 'alb-1', memberIds: ['a1', 'a2'] },
    ]);
    await overrideStore.dissolve({ memberIds: ['a1', 'a2'], dissolvedAt: 1 });

    const units = await service.buildUnits([], 10, fixedRng);

    expect(units.every((u) => u.kind === 'photo')).toBe(true); // no burst — it was dissolved
    expect(new Set(units.map((u) => u.id))).toEqual(new Set(['a1', 'a2']));
  });

  it('re-types a reclassified burst as a pano before hydrating it', async () => {
    albums = [{ id: 'alb-1', name: 'Lisbon' }];
    await metaStore.put('a1', { albumId: 'alb-1', name: 'IMG_1', taken: '2026-05-01T10:00:00Z' });
    await metaStore.put('a2', { albumId: 'alb-1', name: 'IMG_2', taken: '2026-05-01T10:00:02Z' });
    await groupStore.replaceForAlbum('alb-1', [
      { type: 'burst', sourceAlbumId: 'alb-1', memberIds: ['a1', 'a2'] },
    ]);
    await overrideStore.reclassify({
      memberIds: ['a1', 'a2'],
      type: 'pano',
      orientation: 'horizontal',
      at: 1,
    });

    const units = await service.buildUnits([], 10, fixedRng);

    expect(units).toHaveLength(1);
    expect(units[0].kind).toBe('pano');
    if (units[0].kind === 'pano') {
      expect(units[0].orientation).toBe('horizontal');
      expect(units[0].frames.map((f) => f.id)).toEqual(['a1', 'a2']);
    }
  });

  it('gives a pano back the frames the user said it was missing', async () => {
    albums = [{ id: 'alb-1', name: 'Lisbon' }];
    for (const [id, second] of [
      ['a1', '00'],
      ['a2', '02'],
      ['a3', '04'],
    ]) {
      await metaStore.put(id, {
        albumId: 'alb-1',
        name: `IMG_${id}`,
        taken: `2026-05-01T10:00:${second}Z`,
      });
    }
    // Detection found only two of the three frames; the user added the third in the picker.
    await groupStore.replaceForAlbum('alb-1', [
      { type: 'pano', sourceAlbumId: 'alb-1', memberIds: ['a2', 'a3'] },
    ]);
    await overrideStore.setMembers({
      memberIds: ['a2', 'a3'],
      frameIds: ['a1', 'a2', 'a3'],
      at: 1,
    });

    const units = await service.buildUnits([], 10, fixedRng);

    // One unit, not a pano plus a stray single: the added frame belongs to the group now, so
    // selection cannot also draw it on its own.
    expect(units).toHaveLength(1);
    expect(units[0].kind).toBe('pano');
    if (units[0].kind === 'pano') {
      expect(units[0].frames.map((f) => f.id)).toEqual(['a1', 'a2', 'a3']);
    }
  });

  it('marks vacation albums and tolerates an album missing from the album list', async () => {
    albums = []; // 'alb-x' is not in the (empty) album list → album name resolves to null
    await metaStore.put('a1', { albumId: 'alb-x', name: 'IMG_1', taken: '2026-05-01T10:00:00Z' });

    const [single] = await service.buildUnits(['alb-x'], 10, fixedRng);

    expect(single).toMatchObject({ id: 'a1', album: null });
  });

  it('respects the limit', async () => {
    albums = [{ id: 'alb-1', name: 'A' }];
    for (let i = 0; i < 6; i++) {
      await metaStore.put(`a${i}`, { albumId: 'alb-1', name: `IMG_${i}`, taken: '2026-05-01' });
    }

    const units = await service.buildUnits([], 3, fixedRng);

    expect(units).toHaveLength(3);
    expect(new Set(units.flatMap(idsOf)).size).toBe(3);
  });

  describe('a both-eyes album', () => {
    // Marking an album drops its manifest so the next scan re-detects it, but the groups already
    // stored stay as they are until that scan runs. Until then a pair the burst detector had claimed
    // would keep arriving as "which is better, A or B?" — a duel between the two eyes of one shot.
    it('re-types a stored burst as a stereo set, without waiting for the next scan', async () => {
      albums = [{ id: 'alb-1', name: 'Field work' }];
      prefs.stereoAlbumRoles.set({ 'Field work': 'both' });
      await metaStore.put('b1', { albumId: 'alb-1', name: 'DJI_1', taken: '2026-05-01T10:00:00Z' });
      await metaStore.put('b2', { albumId: 'alb-1', name: 'DJI_2', taken: '2026-05-01T10:00:30Z' });
      await groupStore.replaceForAlbum('alb-1', [
        { type: 'burst', sourceAlbumId: 'alb-1', memberIds: ['b1', 'b2'] },
      ]);
      await manifestStore.record('alb-1', [{ id: 'b1' }, { id: 'b2' }], 2);

      const units = await service.buildUnits([], 10, fixedRng);

      expect(units.map((u) => u.kind)).toEqual(['stereo']);
      expect(units.flatMap(idsOf)).not.toContain('b1'); // not a burst: no A-vs-B duel to lose an eye to
    });

    it('offers a frame that paired with nothing as an incomplete pair, once the album is scanned out', async () => {
      await bothEyeAlbumScannedTo(3);

      const units = await service.buildUnits([], 10, fixedRng);

      // Two units: the pair detection found, and a3 — which the detector saw and could not pair, so
      // it is a half, not a photograph. Which eye it is nobody knows: both came out of one album.
      const incomplete = units.find((u): u is Stereo => u.kind === 'stereo' && !!u.gap);
      // Found and searched are the same album, so the card offers one place to go and look.
      const here = { name: 'Field work', id: 'alb-1' };
      expect(incomplete?.gap).toEqual({ missing: 'unknown', foundIn: here, expectedIn: here });
      expect(incomplete?.left.map((f) => f.id)).toEqual(['a3']);
      expect(units.some((u) => u.kind === 'photo')).toBe(false);
    });

    it('keeps that frame off the deck entirely while the album is still being scanned', async () => {
      // The cursor has only reached two of the three images. "a3 paired with nothing" is then a
      // statement about the scan, not about the album, and neither a card nor a photo may claim it.
      await bothEyeAlbumScannedTo(2);

      const units = await service.buildUnits([], 10, fixedRng);

      expect(units.flatMap(idsOf)).not.toContain('a3');
      expect(units.every((u) => u.kind === 'stereo' && !u.gap)).toBe(true);
    });
  });
});
