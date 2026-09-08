import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { PreviewCacheService } from './preview-cache.service';
import { LightroomService } from '../lightroom.service';
import { PreviewStore } from '../storage/review/preview-store';
import { NetworkService } from '../network.service';

describe('PreviewCacheService', () => {
  let service: PreviewCacheService;
  let durable: Map<string, Blob>;
  let fetched: string[];
  /** Stands in for "Wi-Fi only, and this is mobile data" — what the gate is asked. */
  let metered: boolean;

  beforeEach(() => {
    durable = new Map();
    fetched = [];
    metered = false;
    // Object URLs aren't implemented in the test DOM — stub them so caching can be observed.
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    TestBed.configureTestingModule({
      providers: [
        { provide: NetworkService, useValue: { mayDownloadRenditions: () => !metered } },
        {
          provide: PreviewStore,
          useValue: {
            get: (id: string) => Promise.resolve(durable.get(id)),
            put: (id: string, _size: string, blob: Blob) => {
              durable.set(id, blob);
              return Promise.resolve();
            },
            evictExcept: () => Promise.resolve(),
          },
        },
        {
          provide: LightroomService,
          useValue: {
            getPhotoBlob: (id: string) => {
              fetched.push(id);
              return of(new Blob(['x']));
            },
          },
        },
      ],
    });
    service = TestBed.inject(PreviewCacheService);
  });

  afterEach(() => vi.restoreAllMocks());

  it('url() is null before a preview is loaded', () => {
    expect(service.url('a')).toBeNull();
  });

  it('ensure() fetches, caches, and exposes a url; a second call does not re-fetch', async () => {
    await service.ensure('a');
    expect(service.url('a')).not.toBeNull();
    expect(fetched).toEqual(['a']);

    await service.ensure('a');
    expect(fetched).toEqual(['a']); // already cached → no second request
  });

  it('ensure() reuses a durable preview without hitting the network', async () => {
    durable.set('b', new Blob(['x']));
    await service.ensure('b');
    expect(service.url('b')).not.toBeNull();
    expect(fetched).toEqual([]); // served from the durable store
  });

  /**
   * The setting is about spending someone's data plan, not about hiding photographs. A preview
   * already on the device costs nothing to show, so a session warmed on Wi-Fi carries on unchanged
   * when the phone drops to mobile data — only the fetch for a *missing* one is held back.
   */
  describe('on mobile data with "Wi-Fi only" on', () => {
    it('still serves a preview that is already on the device', async () => {
      durable.set('b', new Blob(['x']));
      metered = true;

      await service.ensure('b');

      expect(service.url('b')).not.toBeNull();
      expect(fetched).toEqual([]);
    });

    it('does not download a missing one, and does not mark it failed', async () => {
      metered = true;

      await service.ensure('a');

      expect(fetched).toEqual([]);
      expect(service.url('a')).toBeNull();
      // Not "this photo is broken" — it is simply not here yet, and asking again on Wi-Fi must work.
      expect(service.unavailable('a')).toBe(false);
    });

    it('fetches it after all once back on Wi-Fi', async () => {
      metered = true;
      await service.ensure('a');
      metered = false;

      await service.ensure('a');

      expect(fetched).toEqual(['a']);
      expect(service.url('a')).not.toBeNull();
    });

    it('holds back the precompute warm too', async () => {
      metered = true;

      await service.warmDurable('a');

      expect(fetched).toEqual([]);
      expect(durable.has('a')).toBe(false);
    });
  });

  it('evictOutside() drops previews not in the keep set', async () => {
    await service.ensure('a');
    await service.ensure('b');
    service.evictOutside(new Set(['a']));
    expect(service.url('a')).not.toBeNull();
    expect(service.url('b')).toBeNull();
  });

  it('warmDurable() stores into the durable layer, skipping if already present', async () => {
    await service.warmDurable('c');
    expect(durable.has('c')).toBe(true);
    expect(fetched).toEqual(['c']);

    await service.warmDurable('c');
    expect(fetched).toEqual(['c']); // already durable → not re-fetched
  });

  it('revokeAll() clears the in-memory cache', async () => {
    await service.ensure('a');
    service.revokeAll();
    expect(service.url('a')).toBeNull();
  });

  it('refuses to cache an empty body, so one bad fetch cannot blank a photo for good', async () => {
    // Lightroom does not always have a rendition ready — RAW originals especially — and the proxy
    // used to hand that back as a perfectly ordinary 200 carrying nothing.
    TestBed.resetTestingModule();
    let calls = 0;
    TestBed.configureTestingModule({
      providers: [
        { provide: NetworkService, useValue: { mayDownloadRenditions: () => !metered } },
        {
          provide: PreviewStore,
          useValue: {
            get: (id: string) => Promise.resolve(durable.get(id)),
            put: (id: string, _size: string, blob: Blob) => {
              durable.set(id, blob);
              return Promise.resolve();
            },
            evictExcept: () => Promise.resolve(),
          },
        },
        {
          provide: LightroomService,
          useValue: {
            getPhotoBlob: () => of(calls++ === 0 ? new Blob() : new Blob(['img'])),
          },
        },
      ],
    });
    const svc = TestBed.inject(PreviewCacheService);

    await svc.ensure('raw-1');
    // Nothing kept, and the card is told the picture is missing rather than left silently blank.
    expect(durable.has('raw-1')).toBe(false);
    expect(svc.url('raw-1')).toBeNull();
    expect(svc.unavailable('raw-1')).toBe(true);

    // The decisive part: because nothing was stored, a later attempt still goes to the network and
    // recovers. Caching the empty body made the failure permanent for that asset.
    await svc.ensure('raw-1');
    expect(svc.url('raw-1')).not.toBeNull();
  });
});
