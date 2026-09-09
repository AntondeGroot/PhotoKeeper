import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { KeeperFilingService } from './keeper-filing.service';
import { KeeperAlbumsService } from '../keeper-albums.service';
import { LightroomService } from '../lightroom.service';
import { ReviewStore } from '../storage/review/review-store';
import { KeeperFilingStore } from '../storage/review/keeper-filing-store';
import { AssetMetaStore } from '../storage/review/asset-meta-store';
import { ReviewUndoService } from './review-undo.service';
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
  /** Assets Lightroom refuses outright — a stack answers 403, and only ever fails. */
  let unfilable: Set<string>;
  /** Asset metadata, which is where the filenames a tidy-up search matches on come from. */
  let names: Map<string, { name: string }>;
  /** Assets whose decision the user can still take back, which the sweep must leave alone. */
  let undoable: Set<string>;
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
    unfilable = new Set();
    undoable = new Set();
    heldByAlbum = new Map();
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
              of(
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
});
