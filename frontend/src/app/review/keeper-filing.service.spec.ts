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

  beforeEach(() => {
    verdicts = new Map();
    filed = new Map();
    sent = [];
    failNext = false;
    unfilable = new Set();
    undoable = new Set();
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
   * A bin is a record of one order the user sent deliberately, not a filing any verdict implies.
   * Reported as stale it would ask them to tidy away the very photos they had just ordered.
   */
  it('never asks the user to tidy a print bin', async () => {
    verdicts.set('a', verdict('kept'));
    filed.set('a', { albums: ['KeeperPrint'], at: 1 });

    expect(await filing.staleFilings()).toEqual(new Map());
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

    expect(await filing.staleFilings()).toEqual(new Map([['KeeperEdit', ['DSC_0001']]]));
  });

  it('reports nothing stale while a photo is where its verdict says', async () => {
    verdicts.set('a', verdict('rejected'));
    await filing.sweep();

    expect(await filing.staleFilings()).toEqual(new Map());
  });

  // The search matches on filenames, so a photo the scan has never described cannot be searched for
  // — listing it would produce a link that silently finds nothing.
  it('leaves out a photo whose name is not known', async () => {
    verdicts.set('a', verdict('toEdit'));
    await filing.sweep();
    verdicts.set('a', verdict('toPrint'));
    await filing.sweep();
    names.delete('a');

    expect(await filing.staleFilings()).toEqual(new Map());
  });
});
