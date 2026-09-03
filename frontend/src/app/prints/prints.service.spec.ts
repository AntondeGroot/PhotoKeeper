import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { PrintsService } from './prints.service';
import { AlbumPrintStore } from '../storage/review/album-print-store';
import { FinishedAlbumsService } from './finished-albums.service';
import { LightroomService } from '../lightroom.service';
import { AlbumGroup, Photo } from '../photo';
import { AlbumPrintState } from './prints.types';
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
  });

  it('lists albums with no state as To print, none as Done initially', async () => {
    const service = make();
    await flush(); // the finished-album scan is a store read, not a synchronous view of the deck
    expect(service.toPrint().map((g) => g.album)).toEqual(['Trip', 'Home']);
    expect(service.done()).toEqual([]);
  });

  it('markOrdered moves an album from To print to Done and persists it', async () => {
    const service = make();
    await service.markOrdered('Trip');
    expect(service.toPrint().map((g) => g.album)).toEqual(['Home']);
    expect(service.done().map((g) => g.album)).toEqual(['Trip']);
    expect(setCalls).toContainEqual({ album: 'Trip', state: 'ordered' });
  });

  it('markPlaced removes an album from Done for good (not back to To print)', async () => {
    const service = make();
    await service.markOrdered('Trip');
    await service.markPlaced('Trip');
    expect(service.done()).toEqual([]);
    expect(service.toPrint().map((g) => g.album)).toEqual(['Home']);
    expect(setCalls).toContainEqual({ album: 'Trip', state: 'placed' });
  });

  it('hydrates persisted states on construction', async () => {
    const service = make(new Map<string, AlbumPrintState>([['Trip', 'ordered']]));
    await flush();
    expect(service.done().map((g) => g.album)).toEqual(['Trip']);
    expect(service.toPrint().map((g) => g.album)).toEqual(['Home']);
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
});
