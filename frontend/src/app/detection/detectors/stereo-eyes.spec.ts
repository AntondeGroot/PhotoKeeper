import { splitEyes } from './stereo-eyes';

describe('splitEyes', () => {
  it('trusts an _L / _R file name over the camera body it was shot on', () => {
    // Two bodies. Body "A" sorts first, so on serials alone it would be the left eye — but the
    // file names say the left eye was shot on body "B", and the file names are what the user wrote.
    const split = splitEyes([
      { id: 'l1', fileName: 'IMG_0001_L.jpg', serial: 'B', taken: '' },
      { id: 'r1', fileName: 'IMG_0001_R.jpg', serial: 'A', taken: '' },
      { id: 'l2', fileName: 'DSC_0002.jpg', serial: 'B', taken: '' },
      { id: 'r2', fileName: 'DSC_0002.jpg', serial: 'A', taken: '' },
    ]);

    expect(split).toEqual({ left: ['l1', 'l2'], right: ['r1', 'r2'], unsided: [] });
  });
});
