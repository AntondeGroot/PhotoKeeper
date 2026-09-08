import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { EditDetectionService } from './edit-detection.service';
import { LightroomService } from '../lightroom.service';
import { KeeperAlbumsService } from '../keeper-albums.service';
import { EditBaselineStore } from '../storage/review/edit-baseline-store';
import { HashStore } from '../storage/detection/hash-store';
import { AlbumManifestStore } from '../storage/detection/album-manifest-store';
import { AssetMetaStore } from '../storage/review/asset-meta-store';
import { ReviewStore } from '../storage/review/review-store';
import { ImageHasher } from '../detection/detectors/image-hasher';
import { EditBaseline } from './edit-detection';
import { PhotoAsset } from '../lightroom-types';
import { StoredVerdict } from '../storage/photokeeper-db';

const asset = (id: string, updated: string): PhotoAsset => ({ id, updated }) as PhotoAsset;

/** A rendition whose "pixels" are just the hash the fake hasher will report. */
const rendition = (hash: string): Blob => Object.assign(new Blob(), { hash });

describe('EditDetectionService', () => {
  let service: EditDetectionService;
  let albumAssets: PhotoAsset[];
  let baselines: Map<string, EditBaseline>;
  let renditions: Map<string, Blob>;
  let verdicts: Map<string, StoredVerdict>;
  let blobRequests: string[];
  let editAlbumId: string | null;

  beforeEach(() => {
    albumAssets = [];
    baselines = new Map();
    renditions = new Map();
    // The asset under test is in the edit queue unless a test says otherwise — that is what puts it
    // in front of the check at all.
    verdicts = new Map([['a', { status: 'toEdit', starred: false, saveOnly: false }]]);
    blobRequests = [];
    editAlbumId = 'al-edit';

    TestBed.configureTestingModule({
      providers: [
        {
          provide: LightroomService,
          useValue: {
            getAllAlbumAssets: () => of(albumAssets),
            getPhotoBlob: (id: string) => {
              blobRequests.push(id);
              const blob = renditions.get(id);
              return blob ? of(blob) : throwError(() => new Error('no rendition'));
            },
          },
        },
        {
          provide: KeeperAlbumsService,
          useValue: { ensure: () => Promise.resolve(), idFor: () => editAlbumId },
        },
        {
          provide: EditBaselineStore,
          useValue: {
            getAll: () => Promise.resolve(baselines),
            get: (id: string) => Promise.resolve(baselines.get(id)),
            set: (id: string, b: EditBaseline) => {
              baselines.set(id, b);
              return Promise.resolve();
            },
            remove: (id: string) => {
              baselines.delete(id);
              return Promise.resolve();
            },
          },
        },
        { provide: HashStore, useValue: { get: () => Promise.resolve('stored-hash') } },
        { provide: AlbumManifestStore, useValue: { get: () => Promise.resolve(undefined) } },
        {
          provide: AssetMetaStore,
          useValue: {
            getAll: () => Promise.resolve(new Map([['a', { name: 'DSC_1.NEF' }]])),
            get: () => Promise.resolve(undefined),
          },
        },
        {
          // The hash of a blob is whatever the fake rendition says it is, so a test can stage an
          // edit without decoding anything. The scan's spec stubs the same seam.
          provide: ImageHasher,
          useValue: {
            hash: (blob: Blob) => Promise.resolve((blob as Blob & { hash: string }).hash),
          },
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
      ],
    });
    service = TestBed.inject(EditDetectionService);
  });

  /**
   * The cheap pass earning its keep. Lightroom's revision stamp comes back with the album listing
   * for nothing; a rendition costs a download each. A photo whose stamp has not moved must not be
   * downloaded at all, or "check my edits" would pull the whole album down every time.
   */
  it('downloads nothing for a photo whose revision never moved', async () => {
    albumAssets = [asset('a', 'stamp-1')];
    baselines.set('a', { hash: 'aa', updated: 'stamp-1', at: 0 });

    await service.check();

    expect(blobRequests).toEqual([]);
    expect(service.findings()?.[0].state).toBe('untouched');
  });

  /**
   * The album is not the queue and cannot be — a photo cannot be taken out of a Lightroom album, so
   * everything ever sent to edit is still in KeeperEdit. Without this the check would keep offering
   * photos that were finished weeks ago, and the list would only ever grow.
   */
  it('ignores photos that have already left the edit queue', async () => {
    albumAssets = [asset('a', 'stamp-2'), asset('done', 'stamp-9')];
    verdicts.set('done', { status: 'toPrint', starred: false, saveOnly: false });
    baselines.set('a', { hash: 'aa', updated: 'stamp-1', at: 0 });
    renditions.set('a', rendition('bb'));

    await service.check();

    expect(service.findings()?.map((f) => f.assetId)).toEqual(['a']);
    expect(blobRequests).toEqual(['a']); // and nothing was downloaded for the finished one
  });

  it('reports a photo whose picture changed as edited', async () => {
    albumAssets = [asset('a', 'stamp-2')];
    baselines.set('a', { hash: 'aa', updated: 'stamp-1', at: 0 });
    renditions.set('a', rendition('bb'));

    await service.check();

    expect(blobRequests).toEqual(['a']);
    expect(service.editedFindings().map((f) => [f.assetId, f.name])).toEqual([['a', 'DSC_1.NEF']]);
  });

  /**
   * A rating or a keyword moves the revision without touching the photograph. Offering that as an
   * edit would have the user print the version that was already there.
   */
  it('does not offer a photo whose revision moved but whose picture did not', async () => {
    albumAssets = [asset('a', 'stamp-2')];
    baselines.set('a', { hash: 'aa', updated: 'stamp-1', at: 0 });
    renditions.set('a', rendition('aa'));

    await service.check();

    expect(service.findings()?.[0].state).toBe('touched');
    expect(service.editedFindings()).toEqual([]);
  });

  it('admits to not knowing when it has no earlier version to compare', async () => {
    albumAssets = [asset('a', 'stamp-2')];
    renditions.set('a', rendition('bb'));

    await service.check();

    expect(service.findings()?.[0].state).toBe('unknown');
  });

  it('says so when the album cannot be read, rather than reporting nothing found', async () => {
    editAlbumId = null;

    await service.check();

    expect(service.failed()).toBe(true);
    expect(service.findings()).toEqual([]);
    expect(service.panelOpen()).toBe(true);
  });

  it('makes the chosen photos printable and forgets what they used to look like', async () => {
    baselines.set('a', { hash: 'aa', updated: 'stamp-1', at: 0 });
    verdicts.set('a', { status: 'toEdit', starred: true, saveOnly: false });

    await service.sendToPrint(['a']);

    expect(verdicts.get('a')).toEqual({ status: 'toPrint', starred: true, saveOnly: false });
    expect(baselines.has('a')).toBe(false);
  });

  /**
   * "Not happy with that edit" is the same write as sending it to edit in the first place: this is
   * the version I am starting from. Without it the photo would keep being reported as edited.
   */
  it('re-baselines a photo the user is not finished with', async () => {
    albumAssets = [asset('a', 'stamp-2')];
    baselines.set('a', { hash: 'aa', updated: 'stamp-1', at: 0 });
    renditions.set('a', rendition('bb'));
    await service.check();

    await service.keepEditing(service.editedFindings()[0]);

    expect(baselines.get('a')).toMatchObject({ hash: 'bb', updated: 'stamp-2' });
    expect(service.editedFindings()).toEqual([]);
  });
});
