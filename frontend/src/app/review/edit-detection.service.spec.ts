import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { EditDetectionService } from './edit-detection.service';
import { LightroomService } from '../lightroom.service';
import { KeeperAlbumsService } from '../keeper-albums.service';
import { EditBaselineStore } from '../storage/review/edit-baseline-store';
import { HashStore } from '../storage/detection/hash-store';
import { AlbumManifestStore } from '../storage/detection/album-manifest-store';
import { AssetMetaStore } from '../storage/review/asset-meta-store';
import { GroupStore } from '../storage/detection/group-store';
import { MergedPhotoRecord, PhotoMergeStore } from '../storage/review/photo-merge-store';
import { DetectedGroup } from '../detection/detectors/detection-types';
import { ReviewStore } from '../storage/review/review-store';
import { ReviewFeedService } from './review-feed.service';
import { DailyProgressService } from './daily-progress.service';
import { ImageHasher } from '../detection/detectors/image-hasher';
import { EditBaseline } from './edit-detection';
import { PhotoAsset } from '../lightroom-types';
import { StoredVerdict } from '../storage/photokeeper-db';

const asset = (id: string, updated: string): PhotoAsset => ({ id, updated }) as PhotoAsset;

/** An asset as the album listing gives it: carrying the filename Lightroom imported it under. */
const namedAsset = (id: string, updated: string, fileName: string): PhotoAsset =>
  ({ id, updated, payload: { importSource: { fileName } } }) as PhotoAsset;

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
  /** What the detection scan has hashed. Undefined for most photos — see the baseline tests. */
  let storedHash: string | undefined;
  /** Today's deck, which is what the Edit tab's queue is built from — not the verdict store. */
  let deck: ReturnType<typeof signal<{ id: string; status: string }[]>>;
  /** How many finished edits the day has been told about. */
  let edits: number;
  /** Detected groups, which say which frames a merged panorama's sweep consists of. */
  let groups: DetectedGroup[];
  /** Merges already settled, so a sweep is not offered twice. */
  let mergeRecords: Map<string, MergedPhotoRecord>;
  /** What the scan has stored about each asset — where a merged panorama is noticed by name. */
  let assetMeta: Map<string, { name: string }>;

  beforeEach(() => {
    albumAssets = [];
    baselines = new Map();
    renditions = new Map();
    // The asset under test is in the edit queue unless a test says otherwise — that is what puts it
    // in front of the check at all.
    verdicts = new Map([['a', { status: 'toEdit', starred: false, saveOnly: false }]]);
    blobRequests = [];
    editAlbumId = 'al-edit';
    storedHash = 'stored-hash';
    deck = signal<{ id: string; status: string }[]>([]);
    edits = 0;
    groups = [];
    mergeRecords = new Map();
    assetMeta = new Map([['a', { name: 'DSC_1.NEF' }]]);

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
        { provide: HashStore, useValue: { get: () => Promise.resolve(storedHash) } },
        { provide: AlbumManifestStore, useValue: { get: () => Promise.resolve(undefined) } },
        {
          provide: AssetMetaStore,
          useValue: {
            getAll: () => Promise.resolve(assetMeta),
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
        { provide: GroupStore, useValue: { getAll: () => Promise.resolve(groups) } },
        {
          provide: PhotoMergeStore,
          useValue: {
            getAll: () => Promise.resolve(mergeRecords),
            record: (mergedId: string, frameIds: string[]) => {
              mergeRecords.set(mergedId, { frameIds, at: 1 });
              return Promise.resolve();
            },
          },
        },
        { provide: ReviewFeedService, useValue: { photos: deck } },
        { provide: DailyProgressService, useValue: { recordEdit: () => edits++ } },
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

  /**
   * The bug this covers: the baseline took its hash from the detection scan's store, and the scan
   * only hashes burst and pano *candidates* — a lone photograph, which is most of them, has no hash
   * there at all. So an ordinary photo was sent to edit with a hashless baseline, and the check could
   * only ever answer 'unknown' about it: every real edit was invisible by construction.
   */
  describe('the baseline a photo leaves with', () => {
    it('hashes the photo itself when the scan never did', async () => {
      storedHash = undefined;
      renditions.set('a', rendition('before'));

      await service.captureBaseline('a');

      expect(baselines.get('a')?.hash).toBe('before');
      expect(blobRequests).toEqual(['a']);
    });

    /** The scan's hash is the same measurement already paid for; there is no reason to buy it twice. */
    it('uses the stored hash when there is one, without downloading', async () => {
      await service.captureBaseline('a');

      expect(baselines.get('a')?.hash).toBe('stored-hash');
      expect(blobRequests).toEqual([]);
    });

    it('still records a baseline when the photo cannot be fetched', async () => {
      storedHash = undefined; // and no rendition staged, so the download fails

      await service.captureBaseline('a');

      expect(baselines.has('a')).toBe(true);
      expect(baselines.get('a')?.hash).toBeUndefined();
    });

    /** End to end: send to edit, edit it, and the check must say so. */
    it('lets an ordinary photo’s edit be found afterwards', async () => {
      storedHash = undefined;
      renditions.set('a', rendition('before'));
      await service.captureBaseline('a');

      albumAssets = [asset('a', 'stamp-2')];
      renditions.set('a', rendition('after'));
      await service.check();

      expect(service.editedFindings().map((f) => f.assetId)).toEqual(['a']);
    });
  });

  /**
   * The 26 photos that were already in the queue when the baseline bug was fixed could never be
   * answered for: every run downloaded them, hashed them, threw the measurement away and reported
   * the same nothing. Keeping the hash costs nothing and makes the *next* run able to answer.
   */
  describe('a photo it could not speak for', () => {
    it('still admits it does not know, this time', async () => {
      albumAssets = [asset('a', 'stamp-1')];
      renditions.set('a', rendition('now'));

      await service.check();

      expect(service.findings()?.[0].state).toBe('unknown');
    });

    it('measures it from now on', async () => {
      albumAssets = [asset('a', 'stamp-1')];
      renditions.set('a', rendition('now'));

      await service.check();

      expect(baselines.get('a')).toMatchObject({ hash: 'now', updated: 'stamp-1' });
    });

    /** The point of it: an edit made after this run is found, where before none ever could be. */
    it('finds the next edit it is given', async () => {
      albumAssets = [asset('a', 'stamp-1')];
      renditions.set('a', rendition('before'));
      await service.check();

      albumAssets = [asset('a', 'stamp-2')];
      renditions.set('a', rendition('after'));
      await service.check();

      expect(service.editedFindings().map((f) => f.assetId)).toEqual(['a']);
    });

    /** Nothing to record when the photo could not be fetched — and nothing false written down. */
    it('records nothing when it could not be measured at all', async () => {
      albumAssets = [asset('a', 'stamp-1')]; // no rendition staged: the download fails

      await service.check();

      expect(service.findings()?.[0].state).toBe('unknown');
      expect(baselines.has('a')).toBe(false);
    });
  });

  it('says so when the album cannot be read, rather than reporting nothing found', async () => {
    editAlbumId = null;

    await service.check();

    expect(service.failed()).toBe(true);
    expect(service.findings()).toEqual([]);
    expect(service.panelOpen()).toBe(true);
  });

  /**
   * The escape hatch from the check's blind spots. It cannot speak for a photo it holds no earlier
   * version of, and it will never speak for one sent to edit by a mis-tap — nothing about that photo
   * changed, and nothing should have.
   */
  describe('listing the queue by hand', () => {
    it('offers everything still waiting, and nothing that has left', async () => {
      verdicts.set('b', { status: 'toEdit', starred: false, saveOnly: false });
      verdicts.set('c', { status: 'toPrint', starred: false, saveOnly: false });
      albumAssets = [asset('a', 'stamp-1'), asset('b', 'stamp-1'), asset('c', 'stamp-1')];

      await service.listQueue();

      expect(service.findings()?.map((f) => f.assetId)).toEqual(['a', 'b']);
      expect(service.picking()).toBe(true);
    });

    it('claims nothing about any of them — that is what the user is there for', async () => {
      albumAssets = [asset('a', 'stamp-1')];

      await service.listQueue();

      expect(service.findings()?.[0]).toMatchObject({ state: 'unknown', updated: 'stamp-1' });
    });

    /**
     * Which rows reach the panel, pinned where the rule lives. A photo whose revision moved but whose
     * picture did not is deliberately kept out of the check's list — sending it on would print the
     * version that was already there — but it belongs in a list the user asked to pick from.
     */
    it('shows everything when picking, and only the changed ones after a check', async () => {
      verdicts.set('b', { status: 'toEdit', starred: false, saveOnly: false });
      albumAssets = [asset('a', 'stamp-2'), asset('b', 'stamp-2')];
      baselines.set('a', { hash: 'before', updated: 'stamp-1', at: 1 });
      baselines.set('b', { hash: 'same', updated: 'stamp-1', at: 1 });
      renditions.set('a', rendition('after')); // the picture changed
      renditions.set('b', rendition('same')); // only its metadata did

      await service.check();
      expect(service.shownFindings().map((f) => f.assetId)).toEqual(['a']);

      await service.listQueue();
      expect(service.shownFindings().map((f) => f.assetId)).toEqual(['a', 'b']);
    });

    /**
     * The rows are for picking from, and five of thirty-six in a real KeeperEdit had never been
     * scanned — so they showed a 32-digit asset id where a filename belongs. The listing carries the
     * name for every asset and was already in hand.
     */
    it('names a photo the scan has never reached, from the listing itself', async () => {
      albumAssets = [namedAsset('a', 'stamp-1', 'DJI_0615.DNG')];

      await service.listQueue();

      expect(service.findings()?.[0].name).toBe('DJI_0615.DNG');
    });

    it('falls back to the id only when Lightroom offers no name either', async () => {
      verdicts.set('z', { status: 'toEdit', starred: false, saveOnly: false });
      albumAssets = [asset('z', 'stamp-1')];

      await service.listQueue();

      expect(service.findings()?.[0].name).toBe('z');
    });

    it('says so when the album cannot be read', async () => {
      editAlbumId = null;

      await service.listQueue();

      expect(service.failed()).toBe(true);
      expect(service.panelOpen()).toBe(true);
    });

    /** The two buttons share a panel, so the mode has to be right whichever was pressed last. */
    it('goes back to the check’s own list when the check is run again', async () => {
      albumAssets = [asset('a', 'stamp-1')];
      await service.listQueue();

      await service.check();

      expect(service.picking()).toBe(false);
    });
  });

  it('makes the chosen photos printable and forgets what they used to look like', async () => {
    baselines.set('a', { hash: 'aa', updated: 'stamp-1', at: 0 });
    verdicts.set('a', { status: 'toEdit', starred: true, saveOnly: false });

    await service.sendToPrint(['a']);

    expect(verdicts.get('a')).toEqual({ status: 'toPrint', starred: true, saveOnly: false });
    expect(baselines.has('a')).toBe(false);
  });

  /**
   * The Edit tab's queue is built from the deck held in memory, not from the verdict store, so a
   * photo said to be finished here stayed in the list of things to edit until the app was next
   * reloaded. Two taps of the same meaning have to leave the app in the same state.
   */
  it('takes the photo out of the edit queue on the deck it is standing in', async () => {
    deck.set([
      { id: 'a', status: 'toEdit' },
      { id: 'b', status: 'toEdit' },
    ]);

    await service.sendToPrint(['a']);

    expect(deck()).toEqual([
      { id: 'a', status: 'toPrint' },
      { id: 'b', status: 'toEdit' },
    ]);
  });

  it('counts each finished edit toward the day', async () => {
    await service.sendToPrint(['a', 'b']);

    expect(edits).toBe(2);
  });

  /** The check reads the whole KeeperEdit album, so most of what it finds is not on today's deck. */
  it('still counts one that was never on the deck', async () => {
    deck.set([{ id: 'other', status: 'toEdit' }]);

    await service.sendToPrint(['a']);

    expect(edits).toBe(1);
    expect(deck()).toEqual([{ id: 'other', status: 'toEdit' }]);
    expect(verdicts.get('a')?.status).toBe('toPrint');
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

  /**
   * What the check could never see before. Merging a sweep does not touch its frames — Lightroom
   * writes the panorama beside them as a new photograph — so the frames stayed in the queue
   * reporting "untouched" for ever, while the finished panorama sat in the catalogue with no verdict
   * at all: not printable, and offered for review as though it were a fresh photo.
   */
  describe('frames that have become one photograph', () => {
    /** Three frames sent to edit, and the panorama Lightroom made of them. */
    function sweepMergedInLightroom(): void {
      verdicts = new Map([
        ['f1', { status: 'toEdit', starred: false, saveOnly: false }],
        ['f2', { status: 'toEdit', starred: false, saveOnly: false }],
        ['f3', { status: 'toEdit', starred: false, saveOnly: false }],
      ]);
      assetMeta = new Map([
        ['f1', { name: 'DSC_6468' }],
        ['f2', { name: 'DSC_6469' }],
        ['f3', { name: 'DSC_6470' }],
        ['m1', { name: 'DSC_6470-Pano' }],
      ]);
      groups = [{ type: 'pano', sourceAlbumId: 'alb', memberIds: ['f1', 'f2', 'f3'] }];
    }

    beforeEach(() => sweepMergedInLightroom());

    it('is found by the check, with the whole sweep behind it', async () => {
      await service.check();

      expect(service.merges()).toEqual([
        {
          mergedId: 'm1',
          mergedName: 'DSC_6470-Pano',
          kind: 'panorama',
          frameIds: ['f1', 'f2', 'f3'],
        },
      ]);
    });

    /**
     * The brackets an HDR is merged from are near-identical frames seconds apart, so detection calls
     * them a burst. A rule that only looked at panorama groups would settle the one frame Lightroom
     * named and leave the rest of the bracket sitting in the edit queue.
     */
    it('finds an HDR whose brackets were detected as a burst', async () => {
      assetMeta.set('m1', { name: 'DSC_6470-HDR' });
      groups = [{ type: 'burst', sourceAlbumId: 'alb', memberIds: ['f1', 'f2', 'f3'] }];

      await service.check();

      expect(service.merges()).toEqual([
        {
          mergedId: 'm1',
          mergedName: 'DSC_6470-HDR',
          kind: 'HDR photo',
          frameIds: ['f1', 'f2', 'f3'],
        },
      ]);
    });

    it('makes the merge the one to print', async () => {
      await service.check();
      await service.settleMerge(service.merges()[0]);

      expect(verdicts.get('m1')).toMatchObject({ status: 'toPrint', saveOnly: false });
    });

    /**
     * The frames are the originals and worth keeping — but printing them beside the panorama they
     * were merged into is not what anybody meant.
     */
    it('keeps the frames, out of print orders', async () => {
      await service.check();
      await service.settleMerge(service.merges()[0]);

      for (const frame of ['f1', 'f2', 'f3']) {
        expect(verdicts.get(frame), frame).toMatchObject({ status: 'kept', saveOnly: true });
      }
    });

    /** Which photographs a panorama came from is not recorded anywhere else. */
    it('writes down where the originals are', async () => {
      await service.check();
      await service.settleMerge(service.merges()[0]);

      expect(mergeRecords.get('m1')?.frameIds).toEqual(['f1', 'f2', 'f3']);
    });

    it('takes the sweep out of the edit queue it was waiting in', async () => {
      await service.check();
      await service.settleMerge(service.merges()[0]);
      await service.check();

      expect(service.merges()).toEqual([]);
    });

    /** A panorama already settled must not be offered again on the next check. */
    it('says nothing about a merge already settled', async () => {
      mergeRecords.set('m1', { frameIds: ['f1', 'f2', 'f3'], at: 1 });

      await service.check();

      expect(service.merges()).toEqual([]);
    });

    /** The day's work counts it once: one sweep finished is one edit done. */
    it('counts as an edit finished', async () => {
      await service.check();
      await service.settleMerge(service.merges()[0]);

      expect(edits).toBe(1);
    });
  });
});
