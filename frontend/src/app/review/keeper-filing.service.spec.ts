import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { KeeperFilingService } from './keeper-filing.service';
import { KeeperAlbumsService } from '../keeper-albums.service';
import { LightroomService } from '../lightroom.service';
import { ReviewStore } from '../storage/review/review-store';
import { KeeperFilingStore } from '../storage/review/keeper-filing-store';
import { AssetMetaStore } from '../storage/review/asset-meta-store';
import { ReviewUndoService } from './review-undo.service';
import { CensusService } from '../stats/census.service';
import { PreferencesService } from '../preferences.service';
import { EditBaselineStore } from '../storage/review/edit-baseline-store';
import { GroupStore } from '../storage/detection/group-store';
import { MergeFinderService } from './merge-finder.service';
import { EditBaseline } from './edit-detection';
import { DetectedGroup } from '../detection/detectors/detection-types';
import { FiledRecord, StoredVerdict } from '../storage/photokeeper-db';

const verdict = (status: StoredVerdict['status']): StoredVerdict => ({
  status,
  starred: false,
  saveOnly: false,
});

describe('KeeperFilingService', () => {
  let filing: KeeperFilingService;
  let verdicts: Map<string, StoredVerdict>;
  let filed: Map<string, FiledRecord>;
  let sent: { albumId: string; assetIds: string[] }[];
  let albumIds: Map<string, string>;
  let failNext: boolean;
  /** Stands in for "no network": listing an album throws rather than answering. */
  let failListing: boolean;
  /** Assets Lightroom refuses outright — a stack answers 403, and only ever fails. */
  let unfilable: Set<string>;
  /** Asset metadata, which is where the filenames a tidy-up search matches on come from. */
  let names: Map<string, { name: string }>;
  /** Assets whose decision the user can still take back, which the sweep must leave alone. */
  let undoable: Set<string>;
  /** What the census was told an album holds — it rides along on the listings these checks make. */
  let recorded: { album: string; live: number; deletedIds: readonly string[] }[];
  /** How many photographs KeeperEdit may hold before the app stops sending it more. */
  let editQueueCap: number;
  /** When each photo was sent to edit, which is the order the queue is drained in. */
  let baselines: Map<string, EditBaseline>;
  /** Detected groups, so a sweep's frames are sent together or not at all. */
  let groups: DetectedGroup[];
  /** Frames Lightroom has already merged — finished work, whatever their verdict still says. */
  let mergedFrames: Set<string>;
  /**
   * What each Lightroom album actually holds right now — album id → rows. A string is a photograph;
   * `{tombstone}` is what Lightroom leaves in place of one that has been deleted.
   */
  let heldByAlbum: Map<
    string,
    (string | { tombstone: string } | { named: string; fileName: string })[]
  >;

  beforeEach(() => {
    verdicts = new Map();
    filed = new Map();
    sent = [];
    failNext = false;
    failListing = false;
    unfilable = new Set();
    undoable = new Set();
    heldByAlbum = new Map();
    recorded = [];
    editQueueCap = 30;
    baselines = new Map();
    groups = [];
    mergedFrames = new Set();
    names = new Map([
      ['a', { name: 'DSC_0001' }],
      ['b', { name: 'DSC_0002' }],
      ['c', { name: 'DSC_0003' }],
    ]);
    albumIds = new Map([
      ['KeeperDelete', 'al-del'],
      ['KeeperEdit', 'al-edit'],
      ['KeeperPrint', 'al-print'],
    ]);

    TestBed.configureTestingModule({
      providers: [
        {
          provide: LightroomService,
          useValue: {
            getAllAlbumAssets: (albumId: string) =>
              failListing
                ? throwError(() => new Error('offline'))
                : of(
                    (heldByAlbum.get(albumId) ?? []).map((row, i) => {
                      if (typeof row === 'string') return { id: row, subtype: 'image' };
                      if ('named' in row) {
                        return {
                          id: row.named,
                          subtype: 'image',
                          payload: { importSource: { fileName: row.fileName } },
                        };
                      }
                      return {
                        id: `tomb-${i}`,
                        subtype: 'deleted_image',
                        original: { id: row.tombstone },
                      };
                    }),
                  ),
            addToAlbum: (albumId: string, assetIds: string[]) => {
              if (failNext) return throwError(() => new Error('network'));
              if (assetIds.some((id) => unfilable.has(id))) {
                return throwError(() => new Error('403 AddStackToAlbumRedirectError'));
              }
              sent.push({ albumId, assetIds: [...assetIds] });
              return of(undefined);
            },
          },
        },
        {
          provide: KeeperAlbumsService,
          useValue: {
            ensure: () => Promise.resolve(),
            idFor: (name: string) => albumIds.get(name) ?? null,
          },
        },
        { provide: ReviewStore, useValue: { getVerdicts: () => Promise.resolve(verdicts) } },
        { provide: AssetMetaStore, useValue: { getAll: () => Promise.resolve(names) } },
        { provide: ReviewUndoService, useValue: { heldAssetIds: () => undoable } },
        { provide: PreferencesService, useValue: { editQueueCap: () => editQueueCap } },
        { provide: EditBaselineStore, useValue: { getAll: () => Promise.resolve(baselines) } },
        { provide: GroupStore, useValue: { getAll: () => Promise.resolve(groups) } },
        {
          provide: MergeFinderService,
          useValue: { frameIds: () => mergedFrames, refresh: () => Promise.resolve() },
        },
        {
          provide: CensusService,
          useValue: {
            recordAlbum: (
              album: string,
              counts: { live: number; deletedIds: readonly string[] },
            ) => {
              recorded.push({ album, ...counts });
              return Promise.resolve();
            },
          },
        },
        {
          provide: KeeperFilingStore,
          useValue: {
            getAll: () => Promise.resolve(filed),
            record: (ids: string[], album: string) => {
              ids.forEach((id) => {
                const albums = filed.get(id)?.albums ?? [];
                filed.set(id, { albums: [...albums, album], at: 1 });
              });
              return Promise.resolve();
            },
          },
        },
      ],
    });
    filing = TestBed.inject(KeeperFilingService);
  });

  afterEach(() => filing.dispose());

  it('files each verdict into the album that matches it', async () => {
    verdicts.set('a', verdict('rejected'));
    verdicts.set('b', verdict('toEdit'));

    await filing.sweep();

    expect(sent).toEqual([
      { albumId: 'al-del', assetIds: ['a'] },
      { albumId: 'al-edit', assetIds: ['b'] },
    ]);
  });

  /**
   * Promoting a photo to print while editing used to file it into KeeperPrint within seconds — long
   * before the print set was known. The set is chosen afterwards, over a finished album, and a photo
   * cannot be taken out of a Lightroom album again: every one later set aside as "just save" was
   * stuck there for good. The print set is now sent deliberately, via {@link fileSet}.
   */
  it('does not file a photo promoted to print — that set is sent from the Prints tab', async () => {
    verdicts.set('a', verdict('toPrint'));

    await filing.sweep();

    expect(sent).toEqual([]);
  });

  /**
   * Undo comes first, because filing cannot be undone. Album membership is a one-way write, so a
   * decision filed while it is still on the undo stack would leave the photo in KeeperDelete even
   * after the user took the decision back — the app would forget and Lightroom would not.
   */
  it('holds back a decision the user can still undo', async () => {
    verdicts.set('a', verdict('rejected'));
    verdicts.set('b', verdict('rejected'));
    undoable.add('a');

    await filing.sweep();

    expect(sent).toEqual([{ albumId: 'al-del', assetIds: ['b'] }]);
  });

  /** Once it falls off the stack — or the app restarts, which empties it — the next sweep files it. */
  it('files it as soon as it can no longer be undone', async () => {
    verdicts.set('a', verdict('rejected'));
    undoable.add('a');
    await filing.sweep();
    expect(sent).toEqual([]);

    undoable.clear();
    await filing.sweep();

    expect(sent).toEqual([{ albumId: 'al-del', assetIds: ['a'] }]);
  });

  // Keeping a photograph *is* leaving it where it is, and "maybe" is the absence of a decision.
  // Filing either would put a photo somewhere that says something the user did not.
  it('files nothing for kept or undecided photos', async () => {
    verdicts.set('a', verdict('kept'));
    verdicts.set('b', verdict('maybe'));
    verdicts.set('c', verdict('backlog'));

    await filing.sweep();

    expect(sent).toEqual([]);
  });

  /**
   * Found on a real catalogue: KeeperDelete had nine `burst:…` ids on record as filed and KeeperEdit
   * seven `pano:…` ones. A group card carries a verdict under its own synthetic id, filing walked the
   * verdicts, and Lightroom silently ignores an id it does not know — so the writes looked fine and
   * the ids sat there until the lost-photo check offered to put back things that were never photos.
   */
  it('never asks Lightroom to file a review unit — only its photographs', async () => {
    verdicts.set('burst:alb-1:a', { status: 'rejected', starred: false, saveOnly: false });
    verdicts.set('a', { status: 'rejected', starred: false, saveOnly: false });

    await filing.sweep();

    expect(sent).toEqual([{ albumId: 'al-del', assetIds: ['a'] }]);
  });

  it('does not file the same photo into the same album twice', async () => {
    verdicts.set('a', verdict('rejected'));
    await filing.sweep();
    sent.length = 0;

    await filing.sweep();

    expect(sent).toEqual([]);
  });

  // A photo sent to edit and later promoted to print has to reach KeeperPrint too — so the record
  // is compared against the albums it is already in, not against "has this been filed at all".
  it('files again when the verdict moves it to a different album', async () => {
    verdicts.set('a', verdict('toEdit'));
    await filing.sweep();
    sent.length = 0;

    verdicts.set('a', verdict('rejected'));
    await filing.sweep();

    expect(sent).toEqual([{ albumId: 'al-del', assetIds: ['a'] }]);
  });

  /**
   * A bin is a snapshot of one order, not a filing any verdict implies, so it is not stale merely
   * for holding a photo the verdict map would not have put there. Reported that way it would ask the
   * user to tidy away the very photos they had just ordered.
   */
  it('leaves a print bin alone while its photos are still wanted', async () => {
    verdicts.set('a', verdict('kept'));
    filed.set('a', { albums: ['KeeperPrint'], at: 1 });

    heldByAlbum.set('al-print', ['a']);

    expect(await filing.staleInAlbums()).toEqual(new Map());
  });

  /**
   * The case that undo creates. Mark a photo done editing, send the album's prints to a bin, then
   * take the decision back: the photo is sitting in KeeperPrint and is no longer meant to be
   * printed. Only the user can remove it, so they have to be told which one.
   */
  it('reports a photo whose decision was taken back after it was sent', async () => {
    verdicts.set('a', verdict('toEdit')); // undone: back in the edit queue
    filed.set('a', { albums: ['KeeperPrint'], at: 1 });
    heldByAlbum.set('al-print', [{ named: 'a', fileName: 'DSC_0001.NEF' }]);

    expect(await filing.staleInAlbums()).toEqual(
      new Map([['KeeperPrint', [{ assetId: 'a', name: 'DSC_0001' }]]]),
    );
  });

  /** The same is true of setting one aside on the Prints tab after the set has been sent. */
  it('reports a photo set aside as keep-but-do-not-print after it was sent', async () => {
    verdicts.set('a', { status: 'kept', starred: false, saveOnly: true });
    filed.set('a', { albums: ['KeeperPrint'], at: 1 });
    heldByAlbum.set('al-print', [{ named: 'a', fileName: 'DSC_0001.NEF' }]);

    expect(await filing.staleInAlbums()).toEqual(
      new Map([['KeeperPrint', [{ assetId: 'a', name: 'DSC_0001' }]]]),
    );
  });

  /**
   * The accident this exists for: the photos were removed from KeeperDelete in Lightroom rather than
   * deleted, and the app could not tell. A filing is recorded once and never questioned, so no later
   * sweep would ever put them back — they were simply gone.
   */
  /**
   * The finished photos left behind in KeeperEdit: Lightroom cannot be told to take a photo out of an
   * album, so a photo promoted to print stays where it was sent. Five of the six in a real KeeperEdit
   * had never been scanned, and the record-only list drops a photo it cannot name — so the screen
   * offered one of the six and said nothing about the others.
   */
  describe('what an album is holding that has moved on', () => {
    beforeEach(() => {
      filed.set('a', { albums: ['KeeperEdit'], at: 1 });
      verdicts.set('a', { status: 'toPrint', starred: false, saveOnly: false });
    });

    /**
     * The name Lightroom shows, not the file as imported. These links are a search, and a term of
     * `2021-05-24-DSC_4390.NEF` matches nothing: the photograph is called DSC_4390. Four listed as
     * needing removal behind a link that opened on an empty album read as the app being wrong about
     * the photos rather than about the query.
     */
    it('names a photo the way Lightroom shows it, whatever the file was imported as', async () => {
      names.delete('a');
      heldByAlbum.set('al-edit', [{ named: 'a', fileName: '2021-05-24-DSC_4390.NEF' }]);

      expect(await filing.staleInAlbums()).toEqual(
        new Map([['KeeperEdit', [{ assetId: 'a', name: 'DSC_4390' }]]]),
      );
    });

    it('leaves a plain filename alone', async () => {
      names.delete('a');
      heldByAlbum.set('al-edit', [{ named: 'a', fileName: 'DSC_2609.NEF' }]);

      expect(await filing.staleInAlbums()).toEqual(
        new Map([['KeeperEdit', [{ assetId: 'a', name: 'DSC_2609' }]]]),
      );
    });

    /** Already taken out by hand: the record still says filed, so the record-only answer never stops. */
    it('says nothing about a photo the album no longer holds', async () => {
      heldByAlbum.set('al-edit', []);

      expect(await filing.staleInAlbums()).toEqual(new Map());
    });

    /** Deleting it is an end to it — there is nothing left in the album to take out. */
    it('says nothing about one that was deleted', async () => {
      heldByAlbum.set('al-edit', [{ tombstone: 'a' }]);

      expect(await filing.staleInAlbums()).toEqual(new Map());
    });

    it('leaves a photo that is still where it belongs alone', async () => {
      verdicts.set('a', { status: 'toEdit', starred: false, saveOnly: false });
      heldByAlbum.set('al-edit', [{ named: 'a', fileName: 'DSC_1.NEF' }]);

      expect(await filing.staleInAlbums()).toEqual(new Map());
    });
  });

  describe('what an album has lost', () => {
    /** Rejected photos belong in KeeperDelete, so an absence there is the album having lost them. */
    function rejected(...ids: string[]): void {
      for (const id of ids) {
        filed.set(id, { albums: ['KeeperDelete'], at: 1 });
        verdicts.set(id, { status: 'rejected', starred: false, saveOnly: false });
      }
    }

    it('names the photos it filed that the album no longer holds', async () => {
      rejected('a', 'b', 'c');
      heldByAlbum.set('al-del', ['b']); // a and c were taken out of the album

      expect(await filing.filingGaps()).toEqual([
        { album: 'KeeperDelete', missing: ['a', 'c'], deleted: 0 },
      ]);
    });

    it('reports nothing when every album still holds what it was given', async () => {
      rejected('a');
      heldByAlbum.set('al-del', ['a']);

      expect(await filing.filingGaps()).toEqual([]);
    });

    it('checks each album against its own contents', async () => {
      rejected('a');
      filed.set('b', { albums: ['KeeperEdit'], at: 1 });
      verdicts.set('b', { status: 'toEdit', starred: false, saveOnly: false });
      heldByAlbum.set('al-del', ['a']);
      heldByAlbum.set('al-edit', []);

      expect(await filing.filingGaps()).toEqual([
        { album: 'KeeperEdit', missing: ['b'], deleted: 0 },
      ]);
    });

    /** A photo filed into two albums is missing only from the one that lost it. */
    it('separates a photo’s albums', async () => {
      filed.set('a', { albums: ['KeeperEdit', 'KeeperDelete'], at: 1 });
      verdicts.set('a', { status: 'rejected', starred: false, saveOnly: false });
      heldByAlbum.set('al-edit', ['a']);
      heldByAlbum.set('al-del', []);

      // It belongs in KeeperDelete now, so only that album has lost anything — KeeperEdit is holding
      // one it should not, which is the other half of tidying and not this list's business.
      expect(await filing.filingGaps()).toEqual([
        { album: 'KeeperDelete', missing: ['a'], deleted: 0 },
      ]);
    });

    /** An album the catalogue does not have says nothing about its contents — not that all is lost. */
    it('says nothing about an album that is not in the catalogue', async () => {
      albumIds.delete('KeeperDelete');
      rejected('a');

      expect(await filing.filingGaps()).toEqual([]);
    });

    /** The same junk, already on record from before it was kept out. It can never be put back. */
    it('does not report a review unit as a photo the album lost', async () => {
      filed.set('burst:alb-1:a', { albums: ['KeeperDelete'], at: 1 });
      verdicts.set('burst:alb-1:a', { status: 'rejected', starred: false, saveOnly: false });
      rejected('a');
      heldByAlbum.set('al-del', ['a']);

      expect(await filing.filingGaps()).toEqual([]);
    });

    /**
     * The contradiction this rule exists to make impossible: the screen said three photos should be
     * put back into KeeperEdit while its own other half said those three no longer belonged there.
     * A photo whose verdict has moved on is *meant* to leave, so its absence is the tidying done —
     * and offering to put it back would undo the work the user had just finished.
     */
    it('never asks for back a photo the other half says should go', async () => {
      filed.set('a', { albums: ['KeeperEdit'], at: 1 });
      verdicts.set('a', { status: 'toPrint', starred: false, saveOnly: false }); // done editing
      heldByAlbum.set('al-edit', []); // and already taken out of KeeperEdit by hand

      expect(await filing.filingGaps()).toEqual([]);
      expect(await filing.staleInAlbums()).toEqual(new Map());
    });

    /**
     * Proven against the live API: deleting a photo in Lightroom leaves a `deleted_image` tombstone
     * in every album it was in, under a *new* id that names the old one. Compared by id alone every
     * correctly-deleted photo reads as missing — on a real KeeperDelete that was 49 of them — and
     * offering to put those back is the worst thing this could do.
     */
    it('counts a deleted photo as dealt with, not as one the album lost', async () => {
      rejected('a', 'b');
      heldByAlbum.set('al-del', [{ tombstone: 'a' }, 'b']);

      expect(await filing.filingGaps()).toEqual([
        { album: 'KeeperDelete', missing: [], deleted: 1 },
      ]);
    });

    it('tells the two apart in the same album', async () => {
      rejected('a', 'b', 'c');
      heldByAlbum.set('al-del', [{ tombstone: 'a' }]); // a deleted, b and c taken out by hand

      expect(await filing.filingGaps()).toEqual([
        { album: 'KeeperDelete', missing: ['b', 'c'], deleted: 1 },
      ]);
    });

    it('puts them back where they belong', async () => {
      const filedBack = await filing.fileSet('KeeperDelete', ['a', 'c']);

      expect(filedBack).toBe(2);
      expect(sent).toEqual([{ albumId: 'al-del', assetIds: ['a', 'c'] }]);
    });

    /** A photo genuinely deleted from Lightroom cannot go back, and the count has to say so. */
    it('reports how many could not be put back', async () => {
      unfilable = new Set(['c']);

      expect(await filing.fileSet('KeeperDelete', ['a', 'c'])).toBe(1);
    });
  });

  describe('sending a chosen set', () => {
    it('files exactly the photos it was given, into the album it was named', async () => {
      const filed = await filing.fileSet('KeeperPrint', ['a', 'c']);

      expect(filed).toBe(2);
      expect(sent).toEqual([{ albumId: 'al-print', assetIds: ['a', 'c'] }]);
    });

    /** The bins are albums the user makes by hand, so one may simply not be there yet. */
    it('files nothing when that album is not in the catalogue', async () => {
      albumIds.delete('KeeperPrint');

      const filed = await filing.fileSet('KeeperPrint', ['a']);

      expect(filed).toBe(0);
      expect(sent).toEqual([]);
    });

    it('asks Lightroom nothing for an empty set', async () => {
      expect(await filing.fileSet('KeeperPrint', [])).toBe(0);
      expect(sent).toEqual([]);
    });
  });

  // The album is one the user has to create by hand — the API cannot — so until they do, those
  // photos wait rather than being counted as done.
  it('leaves photos outstanding when their album does not exist yet', async () => {
    albumIds.delete('KeeperDelete');
    verdicts.set('a', verdict('rejected'));

    await filing.sweep();

    expect(sent).toEqual([]);
    expect(filing.blockedByMissingAlbum()).toBe(1);
    expect(filed.has('a')).toBe(false); // still outstanding, so a later sweep picks it up
  });

  // Nothing is recorded as filed unless the write returned, so a failure costs a repeat rather than
  // a photograph that Lightroom never heard about but the app believes it has dealt with.
  it('records nothing when the write fails, and retries next time', async () => {
    verdicts.set('a', verdict('rejected'));
    failNext = true;

    await filing.sweep();
    expect(filed.has('a')).toBe(false);

    failNext = false;
    await filing.sweep();

    expect(sent).toEqual([{ albumId: 'al-del', assetIds: ['a'] }]);
  });

  // Found by the move spike: Lightroom refuses a whole write for one bad member — a stacked asset
  // answers 403, because a stack goes in through a different endpoint. Batched, one such photo
  // failed the other forty-nine with it and nothing was recorded, so the next sweep rebuilt the same
  // batch and failed the same way. One unfilable photo would block its album for good.
  it('files the rest of a batch when one photo cannot be filed', async () => {
    verdicts.set('a', verdict('rejected'));
    verdicts.set('stack', verdict('rejected'));
    verdicts.set('c', verdict('rejected'));
    unfilable.add('stack');

    await filing.sweep();

    expect([...filed.keys()].sort((x, y) => x.localeCompare(y))).toEqual(['a', 'c']);
  });

  it('leaves the one it cannot file outstanding, rather than marking it done', async () => {
    verdicts.set('stack', verdict('rejected'));
    unfilable.add('stack');

    await filing.sweep();

    expect(filed.has('stack')).toBe(false);
    expect(filing.lastFiled()).toBe(0);
  });

  // The residue of a one-way API: filing adds and can never remove, so a photo that moves on stays
  // in its old album for good. The app cannot tidy that up, but it knows exactly what needs it.
  it('reports a photo left behind in an album its verdict has moved on from', async () => {
    verdicts.set('a', verdict('toEdit'));
    await filing.sweep();

    verdicts.set('a', verdict('toPrint'));
    await filing.sweep();
    heldByAlbum.set('al-edit', [{ named: 'a', fileName: 'DSC_0001.NEF' }]);

    expect(await filing.staleInAlbums()).toEqual(
      new Map([['KeeperEdit', [{ assetId: 'a', name: 'DSC_0001' }]]]),
    );
  });

  it('reports nothing stale while a photo is where its verdict says', async () => {
    verdicts.set('a', verdict('rejected'));
    await filing.sweep();
    heldByAlbum.set('al-del', ['a']);

    expect(await filing.staleInAlbums()).toEqual(new Map());
  });

  /**
   * The progress chart's Lightroom side. Listing an album costs a request, so the census never asks
   * for one: it takes what these checks were fetching anyway. A day on which the user never opened
   * Tidy up simply has no album counts, which is honest — nothing looked.
   */
  describe('what it tells the census', () => {
    it('records an album it listed while looking for what was lost', async () => {
      verdicts.set('a', { status: 'rejected', starred: false, saveOnly: false });
      filed.set('a', { albums: ['KeeperDelete'], at: 1 });
      heldByAlbum.set('al-del', ['a', 'b', { tombstone: 'c' }]);

      await filing.filingGaps();

      expect(recorded).toEqual([{ album: 'KeeperDelete', live: 2, deletedIds: ['c'] }]);
    });

    /**
     * A tombstone is a deletion carried out, and it is named rather than tallied: Lightroom purges
     * it after thirty days, so a count taken from the album would fall back to nothing while the
     * deleting had in fact been done. The id is what the ledger needs to count it once, for ever.
     */
    it('names the photographs a tombstone stands for, apart from the live ones', async () => {
      verdicts.set('a', { status: 'kept', starred: false, saveOnly: false });
      filed.set('a', { albums: ['KeeperDelete'], at: 1 });
      heldByAlbum.set('al-del', ['a', { tombstone: 'x' }, { tombstone: 'y' }]);

      await filing.staleInAlbums();

      expect(recorded).toEqual([{ album: 'KeeperDelete', live: 1, deletedIds: ['x', 'y'] }]);
    });
  });

  /**
   * KeeperEdit is a working set, not a second backlog. Four hundred photographs waiting to be edited
   * is the same pile the app exists to clear, moved somewhere else and no longer countable — and
   * since Lightroom cannot be told to take a photo *out* of an album, the only place to hold the
   * line is on the way in.
   */
  describe('the size of the edit queue', () => {
    /** Three photographs decided for editing, oldest first by when each was sent. */
    function threeWaiting(): void {
      for (const [id, at] of [
        ['a', 100],
        ['b', 200],
        ['c', 300],
      ] as const) {
        verdicts.set(id, { status: 'toEdit', starred: false, saveOnly: false });
        baselines.set(id, { at });
      }
    }

    beforeEach(() => threeWaiting());

    it('sends what the album has room for and holds the rest back', async () => {
      editQueueCap = 2;

      await filing.sweep();

      expect(sent).toEqual([{ albumId: 'al-edit', assetIds: ['a', 'b'] }]);
    });

    it('sends nothing at all once the album is full', async () => {
      editQueueCap = 2;
      heldByAlbum.set('al-edit', ['x', 'y']);

      await filing.sweep();

      expect(sent).toEqual([]);
    });

    /**
     * Counted from what the album holds, not from what is still unfinished. Photographs finished
     * long ago cannot be removed from it and take up the same room — counting only the unfinished
     * would call an album of four hundred empty and pour more in.
     */
    it('counts photographs that were finished but could not be removed', async () => {
      editQueueCap = 3;
      heldByAlbum.set('al-edit', ['done-1', 'done-2']);
      verdicts.set('done-1', { status: 'toPrint', starred: false, saveOnly: false });
      verdicts.set('done-2', { status: 'toPrint', starred: false, saveOnly: false });

      await filing.sweep();

      expect(sent).toEqual([{ albumId: 'al-edit', assetIds: ['a'] }]);
    });

    /** A deleted photograph is not taking up room: that one is gone, which is the end of it. */
    it('does not count a tombstone as a photograph in the way', async () => {
      editQueueCap = 2;
      heldByAlbum.set('al-edit', [{ tombstone: 'gone' }]);

      await filing.sweep();

      expect(sent).toEqual([{ albumId: 'al-edit', assetIds: ['a', 'b'] }]);
    });

    /** A sweep is one photograph to edit, so its frames go together even when they do not fit. */
    it('sends a whole panorama rather than half of one', async () => {
      editQueueCap = 1;
      groups = [{ type: 'pano', sourceAlbumId: 'alb', memberIds: ['a', 'b'] }];

      await filing.sweep();

      expect(sent).toEqual([{ albumId: 'al-edit', assetIds: ['a', 'b'] }]);
    });

    /** The other albums are not working sets and are not capped — a rejection must always file. */
    it('leaves the other albums alone', async () => {
      editQueueCap = 0;
      verdicts.set('r', { status: 'rejected', starred: false, saveOnly: false });

      await filing.sweep();

      expect(sent).toEqual([{ albumId: 'al-del', assetIds: ['r'] }]);
    });

    /**
     * The size of the album is a standing fact about it, not a by-product of sending something. Asked
     * only while filing, the Edit tab said the queue was clear until the first decision of the day
     * happened to go through the sweep.
     */
    it('can be asked how full the album is without filing anything', async () => {
      heldByAlbum.set('al-edit', ['x', 'y', 'z']);
      verdicts.clear(); // nothing decided, so nothing for a sweep to send

      await filing.refreshEditQueueSize();

      expect(filing.editQueueHeld()).toBe(3);
      expect(sent).toEqual([]);
    });

    /** A count that failed must leave the last one standing rather than claim the album is empty. */
    it('keeps the size it knew when the album cannot be read', async () => {
      heldByAlbum.set('al-edit', ['x', 'y']);
      await filing.refreshEditQueueSize();

      failListing = true;
      await filing.refreshEditQueueSize();

      expect(filing.editQueueHeld()).toBe(2);
    });

    /**
     * The cap alone does not stop a backlog: work through the easy half and the queue tops itself up
     * for ever, while the same few difficult photographs sit at the bottom being overtaken by
     * whatever was decided this morning. Once one has waited a month, nothing new arrives until it
     * is dealt with — however much room the cap leaves.
     */
    describe('photographs that have waited over a month', () => {
      const day = 24 * 60 * 60 * 1000;

      /** One photograph sent to edit long ago, sitting in the album unedited ever since. */
      function oneLongOverdue(): void {
        verdicts.set('stuck', { status: 'toEdit', starred: false, saveOnly: false });
        baselines.set('stuck', { at: Date.now() - 60 * day });
        heldByAlbum.set('al-edit', ['stuck']);
      }

      it('holds the album shut, however much room the cap leaves', async () => {
        editQueueCap = 30; // room for twenty-nine more
        oneLongOverdue();

        await filing.sweep();

        expect(sent).toEqual([]);
      });

      it('names them, longest wait first', async () => {
        oneLongOverdue();
        verdicts.set('older', { status: 'toEdit', starred: false, saveOnly: false });
        baselines.set('older', { at: Date.now() - 200 * day });
        heldByAlbum.set('al-edit', ['stuck', 'older']);

        await filing.refreshEditQueueSize();

        expect(filing.mandatoryEdits().map((p) => p.assetId)).toEqual(['older', 'stuck']);
      });

      it('lets the album fill again once they are dealt with', async () => {
        oneLongOverdue();
        await filing.sweep();
        verdicts.set('stuck', { status: 'toPrint', starred: false, saveOnly: false }); // edited

        await filing.sweep();

        expect(sent).toEqual([{ albumId: 'al-edit', assetIds: ['a', 'b', 'c'] }]);
      });

      /** A photograph finished months ago and left in the album is nobody's unfinished business. */
      it('ignores one that was finished and simply never removed', async () => {
        verdicts.set('done', { status: 'toPrint', starred: false, saveOnly: false });
        baselines.set('done', { at: Date.now() - 90 * day });
        heldByAlbum.set('al-edit', ['done']);

        await filing.refreshEditQueueSize();

        expect(filing.mandatoryEdits()).toEqual([]);
      });

      /** No listing, no wait: the Edit tab has its answer before any request is made. */
      it('answers from the records alone, without asking Lightroom', async () => {
        filed.set('stuck', { albums: ['KeeperEdit'], at: Date.now() - 60 * day });
        verdicts.set('stuck', { status: 'toEdit', starred: false, saveOnly: false });
        failListing = true; // nothing may reach the catalogue

        await filing.readEditQueueLocally();

        expect(filing.editQueueHeld()).toBe(1);
        expect(filing.mandatoryEdits().map((p) => p.assetId)).toEqual(['stuck']);
      });

      /**
       * A sweep stitched weeks ago is finished work waiting to be confirmed. Left as mandatory it
       * holds the album shut demanding editing that has already been done.
       */
      it('does not hold the album shut for a sweep already merged', async () => {
        filed.set('stuck', { albums: ['KeeperEdit'], at: Date.now() - 60 * day });
        verdicts.set('stuck', { status: 'toEdit', starred: false, saveOnly: false });
        mergedFrames = new Set(['stuck']);

        await filing.readEditQueueLocally();

        expect(filing.mandatoryEdits()).toEqual([]);
      });

      /** A group card's own id is not a photograph and was never in the album. */
      it('does not count a group card as filling the album', async () => {
        filed.set('pano:alb:f1', { albums: ['KeeperEdit'], at: 1 });
        verdicts.set('pano:alb:f1', { status: 'toEdit', starred: false, saveOnly: false });

        await filing.readEditQueueLocally();

        expect(filing.editQueueHeld()).toBe(0);
        expect(filing.mandatoryEdits()).toEqual([]);
      });

      it('says nothing about photographs sent recently', async () => {
        verdicts.set('recent', { status: 'toEdit', starred: false, saveOnly: false });
        baselines.set('recent', { at: Date.now() - 2 * day });
        heldByAlbum.set('al-edit', ['recent']);

        await filing.refreshEditQueueSize();

        expect(filing.mandatoryEdits()).toEqual([]);
      });
    });

    it('says how many are waiting on the phone for room', async () => {
      editQueueCap = 1;

      await filing.sweep();

      expect(filing.editQueueHeld()).toBe(0);
      expect(filing.editQueueWaiting()).toBe(2);
    });
  });
});
