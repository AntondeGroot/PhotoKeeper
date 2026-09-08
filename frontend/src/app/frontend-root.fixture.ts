// Where the frontend project sits on disk, found from this file rather than from the working
// directory.
//
// The specs that read real files — the pano fixtures, the celebration artwork — used to join their
// paths onto `process.cwd()`. That made the suite pass from `frontend/` and fail from any
// subdirectory, always the same seven tests, for reasons that had nothing to do with the change
// under test. A test that reports the caller's shell rather than the code is worse than no test.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The directory holding the frontend's package.json — what every fixture path hangs off. */
export const FRONTEND_ROOT = ((): string => {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, 'package.json'))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`no package.json above ${import.meta.url}`);
    dir = parent;
  }
  return dir;
})();
