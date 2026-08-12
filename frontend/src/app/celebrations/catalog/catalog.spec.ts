import { existsSync } from 'node:fs';
import { CELEBRATION_CATALOG } from './catalog';

describe('celebration CATALOG', () => {
  it('points every entry at an image that actually shipped', () => {
    // The artwork is produced outside the app by tools/celebration-review/export_to_app.py, so a
    // rename there or a typo here is invisible until a celebration shows a broken image to a user.
    // Checking the real files is the only thing that catches it.
    const missing = CELEBRATION_CATALOG.filter(
      (image) => !existsSync(`public/celebrations/${image.file}`),
    ).map((image) => `${image.id} -> ${image.file}`);

    expect(missing).toEqual([]);
  });
});
