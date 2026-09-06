import { KEEPER_PRINT_ALBUM, albumForVerdict, isPrintBin, printBinsIn } from './keeper-albums';
import { firstFreeBin, PrintBin } from './prints/prints.types';

describe('albumForVerdict', () => {
  it('files a rejection and an edit, and leaves the rest of the catalogue alone', () => {
    expect(albumForVerdict('rejected')).toBe('KeeperDelete');
    expect(albumForVerdict('toEdit')).toBe('KeeperEdit');
    expect(albumForVerdict('kept')).toBeNull();
    expect(albumForVerdict('maybe')).toBeNull();
  });

  /**
   * Promoting a photo while editing is several steps before the print set is known: it is chosen
   * afterwards, over a finished album, and includes kept photos too. Filing here put photos in
   * KeeperPrint that the user then set aside — and an album add cannot be taken back.
   */
  it('does not file a photo promoted to print — the set is sent from the Prints tab', () => {
    expect(albumForVerdict('toPrint')).toBeNull();
  });
});

describe('print bins', () => {
  it('treats KeeperPrint and anything named after it as a bin', () => {
    expect(isPrintBin(KEEPER_PRINT_ALBUM)).toBe(true);
    expect(isPrintBin('KeeperPrint 2')).toBe(true);
    expect(isPrintBin('KeeperEdit')).toBe(false);
    expect(isPrintBin('Prints')).toBe(false);
  });

  /** Discovered from the catalogue, because the API cannot create albums — the user makes them. */
  it('finds the bins among the catalogue, in fill order', () => {
    const catalogue = ['Iceland', 'KeeperPrint 2', 'KeeperDelete', 'KeeperPrint', 'KeeperEdit'];

    expect(printBinsIn(catalogue)).toEqual(['KeeperPrint', 'KeeperPrint 2']);
  });

  it('finds one bin when only the required album exists', () => {
    expect(printBinsIn(['KeeperPrint', 'KeeperEdit', 'KeeperDelete'])).toEqual(['KeeperPrint']);
  });

  it('fills the first empty bin, and says so when every one is full', () => {
    const holding = (album: string): PrintBin => ({ album, photos: 1, sentAt: 0 });
    const bins = ['KeeperPrint', 'KeeperPrint 2'];

    expect(firstFreeBin(bins, new Map())).toBe('KeeperPrint');
    expect(firstFreeBin(bins, new Map([['KeeperPrint', holding('Trip')]]))).toBe('KeeperPrint 2');
    expect(
      firstFreeBin(
        bins,
        new Map([
          ['KeeperPrint', holding('Trip')],
          ['KeeperPrint 2', holding('Home')],
        ]),
      ),
    ).toBeNull();
  });
});
