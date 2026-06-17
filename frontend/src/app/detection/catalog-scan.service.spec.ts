import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { CatalogScanService } from './catalog-scan.service';
import { DetectionScanService, ScanReport } from './detection-scan.service';
import { Album, LightroomService } from '../lightroom.service';

const album = (id: string): Album => ({ id, name: id });

const report = (albumId: string, over: Partial<ScanReport> = {}): ScanReport => ({
  albumId,
  skipped: false,
  hashed: 0,
  removed: 0,
  groups: 0,
  ...over,
});

describe('CatalogScanService', () => {
  let service: CatalogScanService;
  let albums: Album[];
  let behavior: Record<string, ScanReport | 'throw'>;
  let calls: string[];

  beforeEach(() => {
    albums = [];
    behavior = {};
    calls = [];

    const svcStub = { getAlbums: () => of(albums) };
    const scanStub = {
      scanAlbum: (id: string) => {
        calls.push(id);
        const outcome = behavior[id];
        return outcome === 'throw' ? Promise.reject(new Error('boom')) : Promise.resolve(outcome);
      },
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: LightroomService, useValue: svcStub },
        { provide: DetectionScanService, useValue: scanStub },
      ],
    });
    service = TestBed.inject(CatalogScanService);
  });

  it('scans every album and aggregates the reports when under budget', async () => {
    albums = [album('a'), album('b'), album('c')];
    behavior = {
      a: report('a', { skipped: true }),
      b: report('b', { hashed: 2, groups: 1 }),
      c: report('c', { hashed: 1, groups: 2 }),
    };

    const summary = await service.scanAllAlbums();

    expect(summary).toEqual({
      albumsTotal: 3,
      processed: 3,
      scanned: 2,
      skipped: 1,
      failed: 0,
      hashed: 3,
      groups: 3,
      completed: true,
    });
    expect(calls).toEqual(['a', 'b', 'c']);
  });

  it('stops at the per-pass hash budget and reports incomplete', async () => {
    albums = [album('a'), album('b'), album('c')];
    behavior = {
      a: report('a', { hashed: 10 }),
      b: report('b', { hashed: 10 }),
      c: report('c', { hashed: 10 }),
    };

    const summary = await service.scanAllAlbums(15);

    expect(summary.processed).toBe(2); // budget hit before the third album
    expect(summary.hashed).toBe(20);
    expect(summary.completed).toBe(false);
    expect(calls).toEqual(['a', 'b']);
  });

  it('keeps going when an album scan throws, counting it as failed', async () => {
    albums = [album('a'), album('b'), album('c')];
    behavior = {
      a: report('a', { hashed: 1 }),
      b: 'throw',
      c: report('c', { hashed: 1 }),
    };

    const summary = await service.scanAllAlbums();

    expect(summary.processed).toBe(3);
    expect(summary.failed).toBe(1);
    expect(summary.scanned).toBe(2);
    expect(summary.hashed).toBe(2);
    expect(summary.completed).toBe(true);
    expect(calls).toEqual(['a', 'b', 'c']);
  });

  it('handles an empty catalog', async () => {
    const summary = await service.scanAllAlbums();

    expect(summary.albumsTotal).toBe(0);
    expect(summary.processed).toBe(0);
    expect(summary.completed).toBe(true);
  });
});
