import { Burst, Pano } from '../../photo';

/**
 * The id a unit takes when re-typed. Replaces the type prefix rather than stacking another, so
 * burst→pano→burst lands back on the id it started from instead of growing `pano:burst:pano:…`
 * forever — the id keys the stored verdict and the day's feed, so every flip otherwise stranded the
 * previous key. Hydrated group ids read `burst:<albumId>:<firstMemberId>` (see unit-selection).
 */
export function retypedId(type: 'burst' | 'pano', id: string): string {
  return `${type}:${id.replace(/^(?:burst:|pano:)+/, '')}`;
}

/** Re-types a burst as a (horizontal) pano in place, keeping its frames, album, time and status. */
export function burstToPano(burst: Burst): Pano {
  return {
    id: retypedId('pano', burst.id),
    name: `Panorama · ${burst.photos.length} frames`,
    album: burst.album,
    taken: burst.taken,
    status: burst.status,
    kind: 'pano',
    orientation: 'horizontal',
    frames: burst.photos.map((p) => ({ id: p.id, name: p.name, blur: p.blur })),
  };
}

/** Re-types a pano as a burst in place, keeping its frames, album, time and status. */
export function panoToBurst(pano: Pano): Burst {
  return {
    id: retypedId('burst', pano.id),
    name: `Burst · ${pano.frames.length} frames`,
    album: pano.album,
    taken: pano.taken,
    status: pano.status,
    kind: 'burst',
    photos: pano.frames.map((f) => ({ id: f.id, name: f.name, blur: f.blur })),
  };
}
