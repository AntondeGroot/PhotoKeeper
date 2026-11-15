import { Burst, Photo } from '../../photo';
import { decidedPhotographs } from './daily-tally';

const frames = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ id: `f${i}`, name: `IMG_${i}` }));

function photo(id: string, status: Photo['status']): Photo {
  return {
    id,
    name: id,
    album: null,
    taken: '2026-11-14',
    status,
    kind: 'photo',
    starred: false,
    saveOnly: false,
  };
}

describe('decidedPhotographs', () => {
  it('counts every frame of a burst: 3 kept out of 10 is 10 photographs judged', () => {
    // What a settled burst leaves on the deck: its 7 rejected frames as one decided burst, and the
    // 3 survivors as photos judged one at a time. Rejecting a frame of a burst is the same work as
    // rejecting a single photo, so the day counts all ten — not 3, and not 4.
    const culled: Burst = {
      id: 'burst:alb:f0',
      name: 'Burst · 7 frames',
      album: null,
      taken: '2026-11-14',
      status: 'rejected',
      kind: 'burst',
      photos: frames(7),
    };

    const deck = [culled, photo('k1', 'kept'), photo('k2', 'kept'), photo('k3', 'toEdit')];

    expect(decidedPhotographs(deck)).toBe(10);
  });
});
