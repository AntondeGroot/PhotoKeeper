import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { PrintsService } from './prints.service';
import { AlbumPrintStore } from '../storage/review/album-print-store';
import { ReviewStatsService } from '../review/review-stats.service';
import { LightroomService } from '../lightroom.service';
import { AlbumGroup, Photo } from '../photo';
import { AlbumPrintState } from './prints.types';

const photo = (id: string): Photo => ({
  id,
  name: id,
  album: null,
  taken: '2026-01-01',
  status: 'toPrint',
  kind: 'photo',
  starred: false,
  keepsake: false,
});
const group = (album: string, ...ids: string[]): AlbumGroup => ({ album, photos: ids.map(photo) });

const flush = () => new Promise((r) => setTimeout(r, 0)); // let the field-initializer load() settle

describe('PrintsService', () => {
  let toPrintByAlbum: ReturnType<typeof signal<AlbumGroup[]>>;
  let setCalls: { album: string; state: AlbumPrintState }[];

  function make(seed: Map<string, AlbumPrintState> = new Map()): PrintsService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: ReviewStatsService, useValue: { toPrintByAlbum } },
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
    toPrintByAlbum = signal<AlbumGroup[]>([group('Trip', 'a', 'b'), group('Home', 'c')]);
    setCalls = [];
  });

  it('lists albums with no state as To print, none as Done initially', () => {
    const service = make();
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
});
