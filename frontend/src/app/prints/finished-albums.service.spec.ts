import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { FinishedAlbumsService } from './finished-albums.service';
import { LightroomService } from '../lightroom.service';
import { AssetMetaStore } from '../storage/review/asset-meta-store';
import { ReviewStore } from '../storage/review/review-store';
import {
  AlbumManifestStore,
  computeAlbumManifest,
} from '../storage/detection/album-manifest-store';
import { ReviewStatus } from '../photo';

describe('FinishedAlbumsService', () => {
  let service: FinishedAlbumsService;
  let meta: AssetMetaStore;
  let reviews: ReviewStore;
  let manifests: AlbumManifestStore;
  /** Every asset each album is known to contain, scanned or not — what the manifest records. */
  let population: Map<string, string[]>;

  beforeEach(() => {
    indexedDB = new IDBFactory();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: LightroomService,
          useValue: {
            getAlbums: () =>
              of([
                { id: 'al-1', name: 'Trip' },
                { id: 'al-2', name: 'Home' },
              ]),
          },
        },
      ],
    });
    service = TestBed.inject(FinishedAlbumsService);
    meta = TestBed.inject(AssetMetaStore);
    reviews = TestBed.inject(ReviewStore);
    manifests = TestBed.inject(AlbumManifestStore);
    population = new Map();
  });

  /** Records the album as fully scanned over everything put in it so far. */
  async function recordManifest(albumId: string, scanned?: number): Promise<void> {
    const ids = population.get(albumId) ?? [];
    await manifests.put(
      albumId,
      computeAlbumManifest(
        ids.map((id) => ({ id })),
        scanned ?? ids.length,
      ),
    );
  }

  /** Puts a photo in an album with a verdict, optionally set aside as "keep, don't print". */
  async function asset(
    id: string,
    albumId: string,
    status: ReviewStatus,
    saveOnly = false,
  ): Promise<void> {
    await meta.put(id, { albumId, name: id, taken: '2026-01-01' });
    await reviews.setVerdict(id, { status, starred: false, saveOnly });
    population.set(albumId, [...(population.get(albumId) ?? []), id]);
    await recordManifest(albumId);
  }

  /**
   * Adds photos the scan has not reached: in the album's population, but with no metadata and no
   * verdict, because nothing has looked at them yet.
   */
  async function unscanned(albumId: string, ...ids: string[]): Promise<void> {
    const covered = (population.get(albumId) ?? []).length;
    population.set(albumId, [...(population.get(albumId) ?? []), ...ids]);
    await recordManifest(albumId, covered);
  }

  it('offers an album only once every photo in it has been dealt with', async () => {
    // Trip is finished: one printed, one kept, one thrown out — nothing outstanding.
    await asset('t1', 'al-1', 'toPrint');
    await asset('t2', 'al-1', 'kept');
    await asset('t3', 'al-1', 'rejected');

    // Home has a photo ready to print, but another still waiting to be edited.
    await asset('h1', 'al-2', 'toPrint');
    await asset('h2', 'al-2', 'toEdit');

    // Ordering prints for a half-sorted album means ordering the wrong set, so Home is held back
    // despite having something printable in it.
    expect((await service.load()).map((g) => g.album)).toEqual(['Trip']);

    // Finish the edit and it joins.
    await reviews.setVerdict('h2', { status: 'kept', starred: false, saveOnly: false });
    // Sorted by name, so the tab does not reshuffle as photos come and go.
    expect((await service.load()).map((g) => g.album)).toEqual(['Home', 'Trip']);
  });

  it('offers a kept photo for printing, not only an edited one', async () => {
    await asset('t1', 'al-1', 'kept');
    await asset('t2', 'al-1', 'toPrint');
    await asset('t3', 'al-1', 'rejected');

    const [trip] = await service.load();

    // 'kept' says the photo needs no editing — it never meant "not worth printing". While it was
    // ignored here, going through the edit step was the only way a photo could reach paper.
    expect(trip.photos.map((p) => p.id)).toEqual(['t1', 't2']);
  });

  it('keeps a photo set aside as "just save" in the album, carrying the choice', async () => {
    await asset('t1', 'al-1', 'kept');
    await asset('t2', 'al-1', 'kept', true);

    const [trip] = await service.load();

    // Leaving it out would make the choice one-way: the photo would disappear from the grid the
    // moment it was set aside, with nothing left to tap to put it back.
    expect(trip.photos.map((p) => [p.id, p.saveOnly])).toEqual([
      ['t1', false],
      ['t2', true],
    ]);
  });

  /**
   * The bug this guards. "Finished" used to be judged over the metadata index, which the scan writes
   * only for the slice it has covered — so an album a third of the way through detection, whose
   * scanned third happened to be decided, was offered for printing with the rest of it never seen.
   */
  it('holds back an album detection has not finished scanning', async () => {
    await asset('t1', 'al-1', 'kept');
    await asset('t2', 'al-1', 'toPrint');
    await unscanned('al-1', 't3', 't4');

    expect(await service.load()).toEqual([]);
  });

  it('offers it once the scan has reached the end of the album', async () => {
    await asset('t1', 'al-1', 'kept');
    await unscanned('al-1', 't2');

    await asset('t2', 'al-1', 'kept');

    expect((await service.load()).map((g) => g.album)).toEqual(['Trip']);
  });
});
