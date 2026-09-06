import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { PrintsService } from './prints.service';
import { AlbumPrintStore } from '../storage/review/album-print-store';
import { PrintBinStore } from '../storage/review/print-bin-store';
import { FinishedAlbumsService } from './finished-albums.service';
import { KeeperAlbumsService } from '../keeper-albums.service';
import { KeeperFilingService } from '../review/keeper-filing.service';
import { LightroomService } from '../lightroom.service';
import { AlbumGroup, Photo } from '../photo';
import { AlbumPrintState, PrintBin, normalisePrintState } from './prints.types';
import { ReviewStore } from '../storage/review/review-store';

const photo = (id: string): Photo => ({
  id,
  name: id,
  album: null,
  taken: '2026-01-01',
  status: 'toPrint',
  kind: 'photo',
  starred: false,
  saveOnly: false,
});
const group = (album: string, ...ids: string[]): AlbumGroup => ({ album, photos: ids.map(photo) });

const flush = () => new Promise((r) => setTimeout(r, 0)); // let the field-initializer load() settle

describe('PrintsService', () => {
  let finished: AlbumGroup[];
  let setCalls: { album: string; state: AlbumPrintState }[];
  let saveOnlyCalls: { id: string; saveOnly: boolean }[];
  /** The print bins the catalogue has, and what the sends actually wrote. */
  let bins: string[];
  let occupied: Map<string, PrintBin>;
  let filedSets: { album: string; assetIds: readonly string[] }[];
  /** Whether the catalogue has answered yet — before it has, an empty bin list means nothing. */
  let binsRead: boolean;
  /** How many photos Lightroom accepts per send — 0 stands in for an album that isn't there. */
  let acceptCount: (assetIds: readonly string[]) => number;

  function make(seed: Map<string, AlbumPrintState> = new Map()): PrintsService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: FinishedAlbumsService, useValue: { load: () => Promise.resolve(finished) } },
        {
          provide: AlbumPrintStore,
          useValue: {
            getAll: () => Promise.resolve(new Map(seed)),
            set: (album: string, state: AlbumPrintState) => {
              setCalls.push({ album, state });
              return Promise.resolve();
            },
          },
        },
        {
          provide: ReviewStore,
          useValue: {
            setSaveOnly: (id: string, saveOnly: boolean) => {
              saveOnlyCalls.push({ id, saveOnly });
              return Promise.resolve();
            },
          },
        },
        {
          provide: PrintBinStore,
          useValue: {
            getAll: () => Promise.resolve(new Map(occupied)),
            occupy: (bin: string, contents: PrintBin) => {
              occupied.set(bin, contents);
              return Promise.resolve();
            },
            free: (bin: string) => {
              occupied.delete(bin);
              return Promise.resolve();
            },
          },
        },
        {
          provide: KeeperAlbumsService,
          useValue: {
            printBins: () => bins,
            checked: () => binsRead,
            ensure: () => Promise.resolve(),
          },
        },
        {
          provide: KeeperFilingService,
          useValue: {
            fileSet: (album: string, assetIds: readonly string[]) => {
              const filed = acceptCount(assetIds);
              if (filed > 0) filedSets.push({ album, assetIds: [...assetIds] });
              return Promise.resolve(filed);
            },
          },
        },
        // No demo albums in these tests — they exercise the real to-print flow.
        {
          provide: LightroomService,
          useValue: { getAlbums: () => of([]), getAllAlbumAssets: () => of([]) },
        },
      ],
    });
    return TestBed.inject(PrintsService);
  }

  beforeEach(() => {
    finished = [group('Trip', 'a', 'b'), group('Home', 'c')];
    setCalls = [];
    saveOnlyCalls = [];
    bins = ['KeeperPrint'];
    binsRead = true;
    occupied = new Map();
    filedSets = [];
    acceptCount = (assetIds) => assetIds.length;
  });

  it('starts every finished album in To print, with the later lanes empty', async () => {
    const service = make();
    await flush(); // the finished-album scan is a store read, not a synchronous view of the deck
    expect(service.toPrint().map((g) => g.album)).toEqual(['Trip', 'Home']);
    expect(service.ordered()).toEqual([]);
    expect(service.done()).toEqual([]);
  });

  it('markOrdered moves an album into Ordered and persists it', async () => {
    const service = make();
    await service.markOrdered('Trip');
    expect(service.toPrint().map((g) => g.album)).toEqual(['Home']);
    expect(service.ordered().map((g) => g.album)).toEqual(['Trip']);
    expect(service.done()).toEqual([]);
    expect(setCalls).toContainEqual({ album: 'Trip', state: 'ordered' });
  });

  /** The end of the journey, so the album lands in Done rather than disappearing. */
  it('markDone moves an album from Ordered into Done', async () => {
    const service = make();
    await service.markOrdered('Trip');
    await service.markDone('Trip');
    expect(service.ordered()).toEqual([]);
    expect(service.done().map((g) => g.album)).toEqual(['Trip']);
    expect(service.toPrint().map((g) => g.album)).toEqual(['Home']);
    expect(setCalls).toContainEqual({ album: 'Trip', state: 'done' });
  });

  it('hydrates persisted states on construction', async () => {
    const service = make(new Map<string, AlbumPrintState>([['Trip', 'ordered']]));
    await flush();
    expect(service.ordered().map((g) => g.album)).toEqual(['Trip']);
    expect(service.toPrint().map((g) => g.album)).toEqual(['Home']);
  });

  /**
   * Albums completed before the journey gained a "received" step carry 'placed'. Read forward rather
   * than cleared: they are finished, and losing the record would put every album ever printed back
   * in the first lane asking to be ordered again.
   */
  it('treats an album completed under the old vocabulary as done', () => {
    expect(normalisePrintState('placed')).toBe('done');
    expect(normalisePrintState('ordered')).toBe('ordered');
    expect(normalisePrintState('done')).toBe('done');
  });

  it('toggleSaveOnly sets a photo aside, and puts it back when tapped again', async () => {
    const service = make();
    await flush();
    const trip = () => service.toPrint()[0].photos;

    await service.toggleSaveOnly(trip()[1]);
    expect(trip().map((p) => p.saveOnly)).toEqual([false, true]);

    // Tapped again it prints once more: the grid is the only place this can be changed, so a
    // one-way flip would leave a mis-tap uncorrectable.
    await service.toggleSaveOnly(trip()[1]);
    expect(trip().map((p) => p.saveOnly)).toEqual([false, false]);

    // Both flips reach the verdict — the choice has to outlive the tab being closed.
    expect(saveOnlyCalls).toEqual([
      { id: 'b', saveOnly: true },
      { id: 'b', saveOnly: false },
    ]);
  });

  describe('sending a set to a print bin', () => {
    it('writes the chosen photos into the free bin and records what is in it', async () => {
      const prints = make();
      await flush();

      await prints.sendToBin(group('Trip', 'a', 'b'));

      expect(filedSets).toEqual([{ album: 'KeeperPrint', assetIds: ['a', 'b'] }]);
      expect(prints.binHolding('Trip')).toBe('KeeperPrint');
      expect(occupied.get('KeeperPrint')).toMatchObject({ album: 'Trip', photos: 2 });
    });

    /**
     * The photos set aside as "just save" are the whole reason the send waits for this moment: they
     * are chosen after the verdicts, and an album add cannot be taken back.
     */
    it('leaves out the photos set aside as just-save', async () => {
      const prints = make();
      await flush();
      const trip = group('Trip', 'a', 'b');
      trip.photos[1] = { ...trip.photos[1], saveOnly: true };

      await prints.sendToBin(trip);

      expect(filedSets).toEqual([{ album: 'KeeperPrint', assetIds: ['a'] }]);
    });

    /**
     * With one KeeperPrint album there is one bin, and a second order has nowhere to go until it is
     * emptied — the API cannot take photos out of an album, so the app cannot make room itself.
     */
    it('refuses a second order while the only bin is still holding one', async () => {
      const prints = make();
      await flush();
      await prints.sendToBin(group('Trip', 'a'));
      filedSets.length = 0;

      await prints.sendToBin(group('Home', 'c'));

      expect(prints.nextBin()).toBeNull();
      expect(filedSets).toEqual([]);
    });

    it('uses the next bin along when the user has made more', async () => {
      bins = ['KeeperPrint', 'KeeperPrint 2'];
      const prints = make();
      await flush();
      await prints.sendToBin(group('Trip', 'a'));

      await prints.sendToBin(group('Home', 'c'));

      expect(filedSets.map((f) => f.album)).toEqual(['KeeperPrint', 'KeeperPrint 2']);
    });

    it('frees a bin once the user has emptied it in Lightroom', async () => {
      const prints = make();
      await flush();
      await prints.sendToBin(group('Trip', 'a'));

      await prints.freeBin('KeeperPrint');

      expect(prints.nextBin()).toBe('KeeperPrint');
      expect(occupied.has('KeeperPrint')).toBe(false);
    });

    /**
     * "No free bin" and "we have not read the catalogue yet" are the same absence, and the tab used
     * to tell people to go and empty an album before it knew what albums they had.
     */
    it('does not claim the bins are full before the catalogue has been read', async () => {
      binsRead = false;
      bins = []; // unread looks exactly like "no bins", which is the whole difficulty
      const prints = make();
      await flush();

      expect(prints.nextBin()).toBeNull();
      expect(prints.binsKnown()).toBe(false); // so the tab says nothing rather than "go empty one"
    });

    it('does say so once the catalogue has answered and every bin is full', async () => {
      const prints = make();
      await flush();
      await prints.sendToBin(group('Trip', 'a'));

      expect(prints.nextBin()).toBeNull();
      expect(prints.binsKnown()).toBe(true);
    });

    /** A refused write must leave the bin free, or the order could never be sent again. */
    it('records nothing when Lightroom accepted none of it', async () => {
      acceptCount = () => 0;
      const prints = make();
      await flush();

      await prints.sendToBin(group('Trip', 'a'));

      expect(prints.binHolding('Trip')).toBeNull();
      expect(prints.nextBin()).toBe('KeeperPrint');
    });
  });
});
