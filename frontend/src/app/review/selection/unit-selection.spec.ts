import { AlbumUnits, selectUnits } from './unit-selection';
import { PhotoAsset } from '../../lightroom-types';
import { DetectedGroup } from '../../detection/detectors/detection-types';
import { Burst, Pano, ReviewItem } from '../../photo';

const asset = (
  id: string,
  captureDate = '2026-05-01T10:00:00Z',
  subtype = 'image',
): PhotoAsset => ({
  id,
  subtype,
  payload: { captureDate, importSource: { fileName: `${id}.dng` } },
});

const burstGroup = (albumId: string, memberIds: string[]): DetectedGroup => ({
  type: 'burst',
  sourceAlbumId: albumId,
  memberIds,
});

const album = (over: Partial<AlbumUnits> & { albumId: string }): AlbumUnits => ({
  albumName: over.albumId,
  isVacation: false,
  assets: [],
  groups: [],
  ...over,
});

// Deterministic rng so selection is reproducible; assertions check content, not shuffle order.
const fixedRng = () => 0;

const idsOf = (unit: ReviewItem): string[] => {
  if (unit.kind === 'burst') return unit.photos.map((p) => p.id);
  if (unit.kind === 'pano') return unit.frames.map((f) => f.id);
  return [unit.id];
};

describe('selectUnits', () => {
  it('returns an empty queue for no albums', () => {
    expect(selectUnits([], 10, fixedRng)).toEqual([]);
  });

  it('surfaces a detected burst as one unit and excludes its members as singles', () => {
    const units = selectUnits(
      [
        album({
          albumId: 'alb-1',
          assets: [asset('a1'), asset('a2'), asset('a3')],
          groups: [burstGroup('alb-1', ['a1', 'a2'])],
        }),
      ],
      10,
      fixedRng,
    );

    expect(units).toHaveLength(2);
    const burst = units.find((u): u is Burst => u.kind === 'burst');
    expect(burst?.photos.map((p) => p.id)).toEqual(['a1', 'a2']);
    expect(burst?.name).toBe('Burst · 2 frames');
    expect(units.filter((u) => u.kind === 'photo').map((u) => u.id)).toEqual(['a3']);
  });

  it('dedupes a repeated member id so a burst never contains the same frame twice', () => {
    const [burst] = selectUnits(
      [
        album({
          albumId: 'alb-1',
          assets: [asset('a1'), asset('a2')],
          groups: [burstGroup('alb-1', ['a1', 'a1', 'a2'])], // 'a1' listed twice
        }),
      ],
      10,
      fixedRng,
    );

    expect(burst.kind).toBe('burst');
    expect(idsOf(burst)).toEqual(['a1', 'a2']); // not ['a1', 'a1', 'a2']
  });

  it('hydrates a burst with album name and the earliest member capture time', () => {
    const [burst] = selectUnits(
      [
        album({
          albumId: 'alb-1',
          albumName: 'Lisbon',
          assets: [asset('b1', '2026-05-01T10:00:05Z'), asset('b2', '2026-05-01T10:00:01Z')],
          groups: [burstGroup('alb-1', ['b1', 'b2'])],
        }),
      ],
      10,
      fixedRng,
    ) as [Burst];

    expect(burst.album).toBe('Lisbon');
    expect(burst.taken).toBe('2026-05-01T10:00:01Z'); // earliest of the two frames
  });

  it('drops a group with fewer than two surviving members, keeping them as singles', () => {
    const units = selectUnits(
      [
        album({
          albumId: 'alb-1',
          assets: [asset('a1')],
          groups: [burstGroup('alb-1', ['a1', 'gone'])], // 'gone' no longer in the album
        }),
      ],
      10,
      fixedRng,
    );

    expect(units).toHaveLength(1);
    expect(units[0].kind).toBe('photo');
    expect(units[0].id).toBe('a1');
  });

  it('excludes non-image assets', () => {
    const units = selectUnits(
      [album({ albumId: 'alb-1', assets: [asset('a1'), asset('v1', '2026-05-01', 'video')] })],
      10,
      fixedRng,
    );

    expect(units.map((u) => u.id)).toEqual(['a1']);
  });

  it('never draws the same asset twice across albums', () => {
    const units = selectUnits(
      [
        album({ albumId: 'alb-1', assets: [asset('a1'), asset('shared')] }),
        album({ albumId: 'alb-2', assets: [asset('shared'), asset('a3')] }),
      ],
      10,
      fixedRng,
    );

    const allIds = units.flatMap(idsOf);
    expect(allIds.filter((id) => id === 'shared')).toHaveLength(1);
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it('surfaces a detected pano as one unit and excludes its frames as singles', () => {
    const units = selectUnits(
      [
        album({
          albumId: 'alb-1',
          albumName: 'Peaks',
          assets: [
            asset('p1', '2026-05-01T10:00:02Z'),
            asset('p2', '2026-05-01T10:00:04Z'),
            asset('p3', '2026-05-01T10:00:06Z'),
            asset('a3'),
          ],
          groups: [{ type: 'pano', sourceAlbumId: 'alb-1', memberIds: ['p1', 'p2', 'p3'] }],
        }),
      ],
      10,
      fixedRng,
    );

    expect(units).toHaveLength(2);
    const pano = units.find((u): u is Pano => u.kind === 'pano');
    expect(pano?.frames.map((f) => f.id)).toEqual(['p1', 'p2', 'p3']);
    expect(pano?.name).toBe('Panorama · 3 frames');
    expect(pano?.album).toBe('Peaks');
    expect(pano?.taken).toBe('2026-05-01T10:00:02Z'); // earliest frame
    expect(pano?.orientation).toBe('horizontal'); // default when the group omits orientation
    expect(units.filter((u) => u.kind === 'photo').map((u) => u.id)).toEqual(['a3']);
  });

  it('carries a vertical pano group through to the hydrated unit', () => {
    const [pano] = selectUnits(
      [
        album({
          albumId: 'alb-1',
          assets: [asset('v1'), asset('v2'), asset('v3')],
          groups: [
            {
              type: 'pano',
              sourceAlbumId: 'alb-1',
              memberIds: ['v1', 'v2', 'v3'],
              orientation: 'vertical',
            },
          ],
        }),
      ],
      10,
      fixedRng,
    ) as [Pano];

    expect(pano.kind).toBe('pano');
    expect(pano.orientation).toBe('vertical');
  });

  it('ignores the stereo group type until its hydrator exists', () => {
    const units = selectUnits(
      [
        album({
          albumId: 'alb-1',
          assets: [asset('a1'), asset('a2'), asset('a3')],
          groups: [{ type: 'stereo', sourceAlbumId: 'alb-1', memberIds: ['a1', 'a2'] }],
        }),
      ],
      10,
      fixedRng,
    );

    expect(units.every((u) => u.kind === 'photo')).toBe(true);
    expect(new Set(units.map((u) => u.id))).toEqual(new Set(['a1', 'a2', 'a3']));
  });

  it('works with the default rng', () => {
    const units = selectUnits(
      [album({ albumId: 'alb-1', assets: [asset('a1'), asset('a2')] })],
      10,
    );

    expect(new Set(units.map((u) => u.id))).toEqual(new Set(['a1', 'a2']));
  });

  it('fills up to the limit from one album beyond the per-album spread cap', () => {
    const many = Array.from({ length: 8 }, (_, i) => asset(`a${i}`));
    const units = selectUnits([album({ albumId: 'alb-1', assets: many })], 6, fixedRng);

    expect(units).toHaveLength(6); // not stuck at UNITS_PER_ALBUM (4)
    expect(new Set(units.map((u) => u.id)).size).toBe(6);
  });

  it('respects the limit, slicing the picked units', () => {
    const many = (prefix: string) => Array.from({ length: 5 }, (_, i) => asset(`${prefix}${i}`));
    const units = selectUnits(
      [
        album({ albumId: 'alb-1', isVacation: true, assets: many('a') }),
        album({ albumId: 'alb-2', assets: many('b') }),
      ],
      3,
      fixedRng,
    );

    expect(units).toHaveLength(3);
    expect(new Set(units.flatMap(idsOf)).size).toBe(3);
  });
});
