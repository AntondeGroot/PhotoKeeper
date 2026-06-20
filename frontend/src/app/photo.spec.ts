import { splitFileName } from './photo';

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
