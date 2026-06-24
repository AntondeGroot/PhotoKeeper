import { AlbumUnits, selectUnits } from './unit-selection';
import { PhotoAsset } from '../../lightroom-types';
import { DetectedGroup } from '../../detection/detectors/detection-types';
import { Burst, Pano, ReviewItem, Stereo, unitAssetIds } from '../../photo';

const asset = (
  id: string,
  captureDate = '2026-05-01T10:00:00Z',
  subtype = 'image',
): PhotoAsset => ({
  id,
  subtype,
  payload: { captureDate, importSource: { fileName: `${id}.dng` } },
});

/** A geotagged frame (drone stereo) — same as `asset` plus a GPS location. */
const geoAsset = (id: string, lat: number, lng: number): PhotoAsset => ({
  id,
  subtype: 'image',
  payload: {
    captureDate: '2026-05-01T10:00:00Z',
    importSource: { fileName: `${id}.dng` },
    location: { latitude: lat, longitude: lng },
  },
});

const stereoGroup = (albumId: string, memberIds: string[]): DetectedGroup => ({
  type: 'stereo',
  sourceAlbumId: albumId,
  memberIds,
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

const idsOf = (unit: ReviewItem): string[] => unitAssetIds(unit);

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

  it('splits a GPS stereo set into a shared left position and distance-labelled baselines', () => {
    const units = selectUnits(
      [
        album({
          albumId: 'alb-s',
          assets: [
            geoAsset('s1', 52.0, 5.0),
            geoAsset('s2', 52.0, 5.0), // same position as s1 → both make up the shared left eye
            geoAsset('s3', 52.0, 5.0000438), // ~3 m east of the reference
            geoAsset('s4', 52.0, 5.000146), // ~10 m east of the reference
          ],
          groups: [stereoGroup('alb-s', ['s1', 's2', 's3', 's4'])],
        }),
      ],
      10,
      fixedRng,
    );

    const stereo = units.find((u): u is Stereo => u.kind === 'stereo')!;
    expect(stereo.name).toBe('Stereo set · 4 frames');
    expect(stereo.left.map((f) => f.id)).toEqual(['s1', 's2']);
    expect(
      stereo.baselines.map((b) => ({
        label: b.label,
        hint: b.hint,
        ids: b.frames.map((f) => f.id),
      })),
    ).toEqual([
      { label: '3 m', hint: '1 frame', ids: ['s3'] }, // baselines sort nearest-first
      { label: '10 m', hint: '1 frame', ids: ['s4'] },
    ]);
  });

  it('reports the measured baseline for a single drone pair', () => {
    const units = selectUnits(
      [
        album({
          albumId: 'alb-s',
          assets: [geoAsset('s1', 52.0, 5.0), geoAsset('s2', 52.0, 5.000073)], // ~5 m apart
          groups: [stereoGroup('alb-s', ['s1', 's2'])],
        }),
      ],
      10,
      fixedRng,
    );

    const stereo = units.find((u): u is Stereo => u.kind === 'stereo')!;
    expect(stereo.left.map((f) => f.id)).toEqual(['s1']);
    expect(stereo.baselines).toEqual([
      { key: 'b0', label: '5 m', hint: '1 frame', frames: [{ id: 's2', name: 's2', ext: 'dng' }] },
    ]);
  });

  it('falls back to a sub-metre pair when GPS can’t resolve the baseline', () => {
    const units = selectUnits(
      [
        album({
          albumId: 'alb-s',
          assets: [geoAsset('s1', 52.0, 5.0), geoAsset('s2', 52.0, 5.000004)], // ~0.3 m apart
          groups: [stereoGroup('alb-s', ['s1', 's2'])],
        }),
      ],
      10,
      fixedRng,
    );

    const stereo = units.find((u): u is Stereo => u.kind === 'stereo')!;
    expect(stereo.left.map((f) => f.id)).toEqual(['s1']);
    expect(stereo.baselines.map((b) => b.label)).toEqual(['<1 m']);
  });

  it('excludes a stereo set’s frames from being drawn as singles', () => {
    const units = selectUnits(
      [
        album({
          albumId: 'alb-s',
          assets: [geoAsset('s1', 52.0, 5.0), geoAsset('s2', 52.0, 5.000146), asset('x1')],
          groups: [stereoGroup('alb-s', ['s1', 's2'])],
        }),
      ],
      10,
      fixedRng,
    );

    expect(units.filter((u) => u.kind === 'photo').map((u) => u.id)).toEqual(['x1']);
    const stereo = units.find((u): u is Stereo => u.kind === 'stereo')!;
    expect(idsOf(stereo).sort((a, b) => a.localeCompare(b))).toEqual(['s1', 's2']);
  });

  it('degrades a stereo set with no GPS to a left frame plus one unlabelled baseline', () => {
    const units = selectUnits(
      [
        album({
          albumId: 'alb-s',
          assets: [asset('s1'), asset('s2'), asset('s3')], // no location → no measurable parallax
          groups: [stereoGroup('alb-s', ['s1', 's2', 's3'])],
        }),
      ],
      10,
      fixedRng,
    );

    const stereo = units.find((u): u is Stereo => u.kind === 'stereo')!;
    expect(stereo.left.map((f) => f.id)).toEqual(['s1']);
    expect(stereo.baselines).toEqual([
      {
        key: 'b0',
        label: 'pair',
        hint: '2 frames',
        frames: [
          { id: 's2', name: 's2', ext: 'dng' },
          { id: 's3', name: 's3', ext: 'dng' },
        ],
      },
    ]);
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
