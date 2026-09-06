import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { KeeperFilingService } from './keeper-filing.service';
import { KeeperAlbumsService } from '../keeper-albums.service';
import { LightroomService } from '../lightroom.service';
import { ReviewStore } from '../storage/review/review-store';
import { KeeperFilingStore } from '../storage/review/keeper-filing-store';
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

  beforeEach(() => {
    verdicts = new Map();
    filed = new Map();
    sent = [];
    failNext = false;
    unfilable = new Set();
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
    verdicts.set('c', verdict('toPrint'));

    await filing.sweep();

    expect(sent).toEqual([
      { albumId: 'al-del', assetIds: ['a'] },
      { albumId: 'al-edit', assetIds: ['b'] },
      { albumId: 'al-print', assetIds: ['c'] },
    ]);
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

    verdicts.set('a', verdict('toPrint'));
    await filing.sweep();

    expect(sent).toEqual([{ albumId: 'al-print', assetIds: ['a'] }]);
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
});
