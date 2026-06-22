import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { CatalogScanService } from './catalog-scan.service';
import { DetectionScanService, ScanReport } from './detection-scan.service';
import { Album, LightroomService } from '../../lightroom.service';
import { AlbumManifestStore } from '../../storage/detection/album-manifest-store';

const album = (id: string): Album => ({ id, name: id });

const report = (albumId: string, over: Partial<ScanReport> = {}): ScanReport => ({
  albumId,
  skipped: false,
  hashed: 0,
  removed: 0,
  groups: 0,
  scanned: 0,
  exhausted: true,
  ...over,
});

describe('CatalogScanService', () => {
  let service: CatalogScanService;
  let albums: Album[];
  let behavior: Record<string, ScanReport | 'throw'>;
  let calls: { id: string; budget: number }[];
  let events: string[]; // ordered log of manifest-clear + per-album scans, for ordering assertions

  beforeEach(() => {
    albums = [];
    behavior = {};
    calls = [];
    events = [];

    const svcStub = { getAlbums: () => of(albums) };
    const scanStub = {
      scanAlbum: (id: string, budget: number) => {
        calls.push({ id, budget });
        events.push(`scan:${id}`);
        const outcome = behavior[id];
        return outcome === 'throw' ? Promise.reject(new Error('boom')) : Promise.resolve(outcome);
      },
    };
    const manifestStub = {
      clear: () => {
        events.push('clear');
        return Promise.resolve();
      },
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: LightroomService, useValue: svcStub },
        { provide: DetectionScanService, useValue: scanStub },
        { provide: AlbumManifestStore, useValue: manifestStub },
      ],
    });
    service = TestBed.inject(CatalogScanService);
  });

  it('scans every album and aggregates the reports when under budget', async () => {
    albums = [album('a'), album('b'), album('c')];
    behavior = {
      a: report('a', { scanned: 0 }), // already fully scanned → counted as skipped
      b: report('b', { scanned: 2, hashed: 2, groups: 1 }),
      c: report('c', { scanned: 1, hashed: 1, groups: 2 }),
    };

    const summary = await service.scanAllAlbums();

    expect(summary).toEqual({
      albumsTotal: 3,
      processed: 3,
      scanned: 2,
      skipped: 1,
      failed: 0,
      scannedImages: 3,
      hashed: 3,
      groups: 3,
      completed: true,
    });
    expect(calls.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('passes the shrinking remaining budget to each album', async () => {
    albums = [album('a'), album('b')];
    behavior = { a: report('a', { scanned: 30 }), b: report('b', { scanned: 10 }) };

    await service.scanAllAlbums(100);

    expect(calls).toEqual([
      { id: 'a', budget: 100 },
      { id: 'b', budget: 70 }, // 100 − 30 already spent on 'a'
    ]);
  });

  it('stops at the per-pass image budget and reports incomplete', async () => {
    albums = [album('a'), album('b'), album('c')];
    behavior = {
      a: report('a', { scanned: 10 }),
      b: report('b', { scanned: 10 }),
      c: report('c', { scanned: 10 }),
    };

    const summary = await service.scanAllAlbums(15);

    expect(summary.processed).toBe(2); // budget exhausted before the third album
    expect(summary.scannedImages).toBe(20); // soft: 'b' pushed past 15
    expect(summary.completed).toBe(false);
    expect(calls.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('keeps going when an album scan throws, counting it as failed', async () => {
    albums = [album('a'), album('b'), album('c')];
    behavior = {
      a: report('a', { scanned: 1 }),
      b: 'throw',
      c: report('c', { scanned: 1 }),
    };

    const summary = await service.scanAllAlbums();

    expect(summary.processed).toBe(3);
    expect(summary.failed).toBe(1);
    expect(summary.scanned).toBe(2);
    expect(summary.scannedImages).toBe(2);
    expect(summary.completed).toBe(true);
    expect(calls.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('handles an empty catalog', async () => {
    const summary = await service.scanAllAlbums();

    expect(summary.albumsTotal).toBe(0);
    expect(summary.processed).toBe(0);
    expect(summary.completed).toBe(true);
  });

  it('rescanAllForcingRedetection clears the manifests before scanning the catalogue', async () => {
    albums = [album('a'), album('b')];
    behavior = { a: report('a', { scanned: 1 }), b: report('b', { scanned: 1 }) };

    const summary = await service.rescanAllForcingRedetection();

    expect(events).toEqual(['clear', 'scan:a', 'scan:b']); // manifests wiped first, then a full scan
    expect(summary.processed).toBe(2);
  });
});
