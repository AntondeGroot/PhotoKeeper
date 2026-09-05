import { Burst, Pano, Photo, Stereo, splitFileName, unitAssetIds } from './photo';

describe('splitFileName', () => {
  it('splits a normal filename into name + extension (no dot)', () => {
    expect(splitFileName('IMG_4044.CR2')).toEqual({ name: 'IMG_4044', ext: 'CR2' });
    expect(splitFileName('IMG-20260602-WA0041.jpg')).toEqual({
      name: 'IMG-20260602-WA0041',
      ext: 'jpg',
    });
  });

  it('keeps only the last extension on a multi-dot name', () => {
    expect(splitFileName('panorama.stitched.tif')).toEqual({
      name: 'panorama.stitched',
      ext: 'tif',
    });
  });

  it('returns no ext when there is none to take', () => {
    expect(splitFileName('IMG_4044')).toEqual({ name: 'IMG_4044' }); // no dot
    expect(splitFileName('.gitignore')).toEqual({ name: '.gitignore' }); // leading dot only
    expect(splitFileName('trailing.')).toEqual({ name: 'trailing.' }); // trailing dot only
  });
});

/**
 * The one function that turns a review unit back into the photographs it stands for.
 *
 * Load-bearing far beyond its size: preview warming and eviction, the sampler's "already used" set,
 * the buffer's staleness check and the prefetch window all ask it which files a unit is about. A
 * kind it expanded wrongly would not fail anywhere — it would quietly evict previews still in use,
 * or let a frame be drawn twice, in whichever corner of the app noticed last.
 */
describe('unitAssetIds', () => {
  const base = { album: 'Trip', taken: '2026-01-01', status: 'backlog' as const };

  it('gives a plain photo its own id', () => {
    const photo: Photo = {
      ...base,
      id: 'a',
      name: 'a',
      kind: 'photo',
      starred: false,
      saveOnly: false,
    };

    expect(unitAssetIds(photo)).toEqual(['a']);
  });

  // An edit and its original are one unit — both are warmed, both are spent, and the verdict covers
  // the pair. Missing the original would evict the very file the card compares against.
  it('gives an edited photo both files', () => {
    const edited: Photo = {
      ...base,
      id: 'nr',
      name: 'nr',
      kind: 'photo',
      starred: false,
      saveOnly: false,
      edit: { originalId: 'raw', originalName: 'raw' },
    };

    expect(unitAssetIds(edited)).toEqual(['nr', 'raw']);
  });

  it('gives a burst every frame, not its synthetic unit id', () => {
    const burst: Burst = {
      ...base,
      id: 'burst:alb-1:f1',
      name: 'Burst · 3 frames',
      kind: 'burst',
      photos: [
        { id: 'f1', name: 'f1' },
        { id: 'f2', name: 'f2' },
        { id: 'f3', name: 'f3' },
      ],
    };

    expect(unitAssetIds(burst)).toEqual(['f1', 'f2', 'f3']);
  });

  it('gives a panorama every frame', () => {
    const pano: Pano = {
      ...base,
      id: 'pano:alb-1:p1',
      name: 'Panorama · 2 frames',
      kind: 'pano',
      orientation: 'horizontal',
      frames: [
        { id: 'p1', name: 'p1' },
        { id: 'p2', name: 'p2' },
      ],
    };

    expect(unitAssetIds(pano)).toEqual(['p1', 'p2']);
  });

  // The most easily got wrong: a set is a shared left eye plus one or more baselines, so the frames
  // live at two depths. Reaching only the left ones would strip every right eye of its preview — the
  // 2048px ones, and the largest thing the store holds.
  it('gives a stereo set both eyes, across every baseline', () => {
    const stereo: Stereo = {
      ...base,
      id: 'stereo:alb-1:l1',
      name: 'Stereo set · 4 frames',
      kind: 'stereo',
      left: [{ id: 'l1', name: 'l1' }],
      baselines: [
        { key: 'b0', label: '3 m', hint: '', frames: [{ id: 'r1', name: 'r1' }] },
        {
          key: 'b1',
          label: '10 m',
          hint: '',
          frames: [
            { id: 'r2', name: 'r2' },
            { id: 'r3', name: 'r3' },
          ],
        },
      ],
    };

    expect(unitAssetIds(stereo)).toEqual(['l1', 'r1', 'r2', 'r3']);
  });

  // An incomplete pair has an empty side by construction, and it still has to name the eye it has.
  it('gives an incomplete stereo pair the one frame it has', () => {
    const half: Stereo = {
      ...base,
      id: 'stereo-gap:l9',
      name: 'Stereo pair · right eye missing',
      kind: 'stereo',
      left: [{ id: 'l9', name: 'l9' }],
      baselines: [{ key: 'b0', label: 'incomplete pair', hint: '1 frame', frames: [] }],
      gap: { missing: 'right', foundIn: { name: 'L', id: 'al-l' }, expectedIn: null },
    };

    expect(unitAssetIds(half)).toEqual(['l9']);
  });
});
