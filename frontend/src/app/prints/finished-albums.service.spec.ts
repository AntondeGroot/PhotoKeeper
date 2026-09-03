import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { FinishedAlbumsService } from './finished-albums.service';
import { LightroomService } from '../lightroom.service';
import { AssetMetaStore } from '../storage/review/asset-meta-store';
import { ReviewStore } from '../storage/review/review-store';
import { ReviewStatus } from '../photo';

describe('FinishedAlbumsService', () => {
  let service: FinishedAlbumsService;
  let meta: AssetMetaStore;
  let reviews: ReviewStore;

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
  });

  /** Puts a photo in an album with a verdict, optionally set aside as "keep, don't print". */
  async function asset(
    id: string,
    albumId: string,
    status: ReviewStatus,
    saveOnly = false,
  ): Promise<void> {
    await meta.put(id, { albumId, name: id, taken: '2026-01-01' });
    await reviews.setVerdict(id, { status, starred: false, saveOnly });
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
});
