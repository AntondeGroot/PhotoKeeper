import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { ReconsiderService } from './reconsider.service';
import { LightroomService } from '../lightroom.service';
import { KeeperAlbumsService } from '../keeper-albums.service';
import { ReviewStore } from '../storage/review/review-store';
import { AssetMetaStore } from '../storage/review/asset-meta-store';
import { ReviewFeedService } from './review-feed.service';
import { StoredVerdict } from '../storage/photokeeper-db';
import { PhotoAsset } from '../lightroom-types';

const image = (id: string, fileName: string): PhotoAsset => ({
  id,
  subtype: 'image',
  payload: { importSource: { fileName } },
});

/** What Lightroom leaves in an album in place of a photo that has been deleted. */
const tombstone = (id: string): PhotoAsset => ({
  id,
  subtype: 'deleted_image',
  original: { id: 'gone' },
});

describe('ReconsiderService', () => {
  let service: ReconsiderService;
  let held: PhotoAsset[];
  let verdicts: Map<string, StoredVerdict>;
  let deck: ReturnType<typeof signal<{ id: string; status: string }[]>>;
  let albumId: string | null;

  beforeEach(() => {
    held = [];
    verdicts = new Map();
    deck = signal<{ id: string; status: string }[]>([]);
    albumId = 'al-del';

    TestBed.configureTestingModule({
      providers: [
        {
          provide: LightroomService,
          useValue: {
            getAllAlbumAssets: () => of(held),
            getPhotoBlob: () => of(new Blob(['x'])),
          },
        },
        {
          provide: KeeperAlbumsService,
          useValue: { ensure: () => Promise.resolve(), idFor: () => albumId },
        },
        {
          provide: ReviewStore,
          useValue: {
            getVerdicts: () => Promise.resolve(verdicts),
            setVerdict: (id: string, v: StoredVerdict) => {
              verdicts.set(id, v);
              return Promise.resolve();
            },
          },
        },
        { provide: AssetMetaStore, useValue: { getAll: () => Promise.resolve(new Map()) } },
        { provide: ReviewFeedService, useValue: { photos: deck } },
      ],
    });
    service = TestBed.inject(ReconsiderService);
  });

  describe('what an album holds', () => {
    it('names each photo and says what the app currently thinks of it', async () => {
      held = [image('a', 'DSC_1.NEF')];
      verdicts.set('a', { status: 'rejected', starred: false, saveOnly: false });

      expect(await service.photosIn('KeeperDelete')).toEqual([
        { assetId: 'a', name: 'DSC_1.NEF', status: 'rejected' },
      ]);
    });

    /** A deleted photograph has no verdict left worth reconsidering. */
    it('leaves out the headstones of deleted photos', async () => {
      held = [image('a', 'DSC_1.NEF'), tombstone('t')];

      expect((await service.photosIn('KeeperDelete')).map((p) => p.assetId)).toEqual(['a']);
    });

    it('says so when the catalogue has no such album', async () => {
      albumId = null;

      await expect(service.photosIn('KeeperDelete')).rejects.toThrow();
    });
  });

  describe('giving a photo a new verdict', () => {
    it('writes it', async () => {
      verdicts.set('a', { status: 'rejected', starred: false, saveOnly: false });

      await service.reverdict('a', 'kept');

      expect(verdicts.get('a')?.status).toBe('kept');
    });

    /**
     * Starred and keep-but-do-not-print say something about the photograph, not about the decision
     * being taken back — losing them would be an invisible second change nobody asked for.
     */
    it('carries the flags that are not about this decision', async () => {
      verdicts.set('a', { status: 'rejected', starred: true, saveOnly: true });

      await service.reverdict('a', 'kept');

      expect(verdicts.get('a')).toEqual({ status: 'kept', starred: true, saveOnly: true });
    });

    /**
     * The tabs are built from the deck, not from the store, so a photo re-judged here would keep
     * its old standing on screen until the app was next reloaded.
     */
    it('tells the deck, when the photo is standing in it', async () => {
      deck.set([
        { id: 'a', status: 'rejected' },
        { id: 'b', status: 'kept' },
      ]);

      await service.reverdict('a', 'kept');

      expect(deck()).toEqual([
        { id: 'a', status: 'kept' },
        { id: 'b', status: 'kept' },
      ]);
    });

    it('is fine about a photo the deck has never heard of', async () => {
      deck.set([{ id: 'other', status: 'kept' }]);

      await service.reverdict('a', 'kept');

      expect(verdicts.get('a')?.status).toBe('kept');
      expect(deck()).toEqual([{ id: 'other', status: 'kept' }]);
    });
  });
});
