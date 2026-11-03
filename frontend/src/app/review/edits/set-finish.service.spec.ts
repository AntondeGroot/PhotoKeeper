import { TestBed } from '@angular/core/testing';
import { DailyProgressService } from '../progress/daily-progress.service';
import { EditCandidatesService } from './edit-candidates.service';
import { EditDetectionService } from './edit-detection.service';
import { MergeFinderService } from './merge-finder.service';
import { MergedPhoto } from './merged-photo';
import { SetFinishService } from './set-finish.service';

describe('SetFinishService', () => {
  let service: SetFinishService;
  let found: MergedPhoto[];
  let albumUnreadable: boolean;
  /** What the last search was asked to look around. */
  let searchedFor: readonly string[];
  /** How many searches have started. */
  let searches: number;
  /** Every write that would decide something about a photograph. */
  let writes: string[];

  beforeEach(() => {
    found = [];
    albumUnreadable = false;
    searchedFor = [];
    writes = [];
    searches = 0;
    TestBed.configureTestingModule({
      providers: [
        {
          provide: MergeFinderService,
          useValue: {
            searchFor: (ids: readonly string[]) => {
              searchedFor = ids;
              searches++;
              return albumUnreadable
                ? Promise.reject(new Error('offline'))
                : Promise.resolve(found);
            },
          },
        },
        {
          provide: EditDetectionService,
          useValue: {
            settleMerge: (merge: MergedPhoto) => {
              writes.push(`settleMerge:${merge.mergedId}`);
              return Promise.resolve();
            },
            standDown: (frameIds: readonly string[]) => {
              writes.push(`standDown:${frameIds.join()}`);
              return Promise.resolve();
            },
            sendToPrint: () => {
              writes.push('sendToPrint');
              return Promise.resolve();
            },
            dropFindings: () => writes.push('dropFindings'),
          },
        },
        {
          provide: EditCandidatesService,
          useValue: {
            refresh: () => {
              writes.push('refresh');
              return Promise.resolve();
            },
          },
        },
        {
          provide: DailyProgressService,
          useValue: { recordEdit: () => writes.push('recordEdit') },
        },
      ],
    });
    service = TestBed.inject(SetFinishService);
  });

  /**
   * The mistake this service exists to prevent: frames reaching KeeperPrint, which Lightroom will
   * not let the app undo. With no merged file found, nothing may be decided at all.
   */
  it('writes nothing when no merged file is found, and says so', async () => {
    await service.finish('f1', ['f1', 'f2', 'f3']);

    expect(writes).toEqual([]);
    expect(service.state().get('f1')).toBe('not-found');
  });

  /** The one tap this all exists for: the merged file becomes the photograph and the row is gone. */
  it('confirms the merged file when there is exactly one, and takes the row away', async () => {
    found = [
      { mergedId: 'm1', mergedName: 'f1-Pano', kind: 'panorama', frameIds: ['f1', 'f2', 'f3'] },
    ];

    await service.finish('f1', ['f1', 'f2', 'f3']);

    expect(writes).toEqual(['settleMerge:m1', 'dropFindings', 'refresh']);
    expect(service.state().has('f1')).toBe(false);
  });

  /**
   * The same sweep merged twice leaves `-Pano` and `-Pano-2`, and only the person knows which is the
   * photograph. Each has its own card, so the row goes and nothing is decided on their behalf.
   */
  it('chooses neither when there are several merged files, and takes the row away', async () => {
    const frameIds = ['f1', 'f2', 'f3'];
    found = [
      { mergedId: 'm1', mergedName: 'f1-Pano', kind: 'panorama', frameIds },
      { mergedId: 'm2', mergedName: 'f1-Pano-2', kind: 'panorama', frameIds },
    ];

    await service.finish('f1', frameIds);

    expect(writes).toEqual(['dropFindings', 'refresh']);
    expect(service.state().has('f1')).toBe(false);
  });

  /**
   * "Could not look" is not "not there". Told apart because only the second offers finishing without
   * a merge, and a dropped connection is no reason to give up on a file that may well exist.
   */
  it('reports Lightroom unreachable and writes nothing when the album cannot be read', async () => {
    albumUnreadable = true;

    await service.finish('f1', ['f1', 'f2', 'f3']);

    expect(writes).toEqual([]);
    expect(service.state().get('f1')).toBe('unreachable');
  });

  /**
   * The way out for a sweep nobody is going to stitch. Its frames must stay out of print orders, since
   * an album membership cannot be taken back, and the sweep counts as one edit however many it has.
   */
  it('keeps the frames out of print when finishing without a merge, counting one edit', async () => {
    const frameIds = ['f1', 'f2', 'f3'];
    await service.finish('f1', frameIds);

    await service.finishWithoutMerge('f1', frameIds);

    expect(writes).toEqual(['standDown:f1,f2,f3', 'recordEdit', 'dropFindings', 'refresh']);
    expect(service.state().has('f1')).toBe(false);
  });

  /**
   * A card comes from this device's records, which can outlive the file. Confirming a deleted merged
   * file would leave nothing to print and the frames stood down, so nothing is written and the
   * refresh brings the sweep's row back. The merged file's own id goes into the search because its
   * tombstone is in its own album.
   */
  it('confirms nothing when a card\u2019s merged file has since been deleted', async () => {
    const card: MergedPhoto = {
      mergedId: 'm1',
      mergedName: 'f1-Pano',
      kind: 'panorama',
      frameIds: ['f1', 'f2'],
    };

    await service.confirmMerge(card);

    expect(searchedFor).toEqual(['f1', 'f2', 'm1']);
    expect(writes).toEqual(['refresh']);
    expect(service.state().has('m1')).toBe(false);
  });

  /**
   * The card tapped is the one confirmed. The same sweep merged twice has two cards, and whichever
   * the person chose is the photograph, even though the search lists the other one first.
   */
  it('confirms the card that was tapped when its merged file is still there', async () => {
    const frameIds = ['f1', 'f2'];
    const card: MergedPhoto = {
      mergedId: 'm2',
      mergedName: 'f1-Pano-2',
      kind: 'panorama',
      frameIds,
    };
    found = [{ mergedId: 'm1', mergedName: 'f1-Pano', kind: 'panorama', frameIds }, card];

    await service.confirmMerge(card);

    expect(writes).toEqual(['settleMerge:m2', 'dropFindings', 'refresh']);
    expect(service.state().has('m2')).toBe(false);
  });

  /**
   * Another merged file from the sweep says nothing about this one. Confirming the deleted one would
   * stand the frames down for a photograph that no longer exists, and take the survivor's card away.
   */
  it('confirms nothing for a deleted card even when the sweep has another merged file', async () => {
    const frameIds = ['f1', 'f2'];
    const card: MergedPhoto = { mergedId: 'm1', mergedName: 'f1-Pano', kind: 'panorama', frameIds };
    found = [{ mergedId: 'm2', mergedName: 'f1-Pano-2', kind: 'panorama', frameIds }];

    await service.confirmMerge(card);

    expect(writes).toEqual(['refresh']);
    expect(service.state().has('m1')).toBe(false);
  });

  /**
   * A card is confirmed only on Lightroom's word that the file is still there. Without an answer it
   * stays, saying why, until a retry gets one. The list is not refreshed either: nothing has changed,
   * and the card has to still be standing to carry the message.
   */
  it('saves nothing and keeps the card when Lightroom cannot be reached', async () => {
    const card: MergedPhoto = {
      mergedId: 'm1',
      mergedName: 'f1-Pano',
      kind: 'panorama',
      frameIds: ['f1', 'f2'],
    };
    albumUnreadable = true;

    await service.confirmMerge(card);

    expect(writes).toEqual([]);
    expect(service.state().get('m1')).toBe('unreachable');
  });

  /**
   * The person has already said this is the panorama, so a dropped connection should not make them
   * say it twice. Lightroom's answer is still what decides: the retry searches again before writing.
   */
  it('retries a waiting card when the connection returns, confirming it without a tap', async () => {
    const card: MergedPhoto = {
      mergedId: 'm1',
      mergedName: 'f1-Pano',
      kind: 'panorama',
      frameIds: ['f1', 'f2'],
    };
    albumUnreadable = true;
    await service.confirmMerge(card);
    albumUnreadable = false;
    found = [card];

    window.dispatchEvent(new Event('online'));
    await new Promise((resolve) => setTimeout(resolve));

    expect(writes).toEqual(['settleMerge:m1', 'dropFindings', 'refresh']);
    expect(service.state().has('m1')).toBe(false);
  });

  /**
   * A retry can write what cannot be undone, so changing your mind while it waits has to hold. The
   * second tap only cancels, and after that the connection returning does not even start a search.
   */
  it('stops waiting when a waiting card is tapped again, so no retry runs later', async () => {
    const card: MergedPhoto = {
      mergedId: 'm1',
      mergedName: 'f1-Pano',
      kind: 'panorama',
      frameIds: ['f1', 'f2'],
    };
    albumUnreadable = true;
    await service.cardTapped(card);
    expect(service.state().get('m1')).toBe('unreachable');
    albumUnreadable = false;
    found = [card];
    searchedFor = [];

    await service.cardTapped(card);
    window.dispatchEvent(new Event('online'));
    await new Promise((resolve) => setTimeout(resolve));

    expect(searchedFor).toEqual([]);
    expect(writes).toEqual([]);
    expect(service.state().has('m1')).toBe(false);
  });

  /**
   * Coming back to the app is the only signal when it is Lightroom rather than the connection that
   * failed. Coming back often arrives together with the connection, and confirming twice would count
   * the edit twice, so the second event must find nothing left to start. Leaving the app says nothing
   * about Lightroom, so it starts nothing.
   */
  it('retries on coming back to the app, and only once when both events arrive', async () => {
    const setVisibility = (state: DocumentVisibilityState): void => {
      Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    const card: MergedPhoto = {
      mergedId: 'm1',
      mergedName: 'f1-Pano',
      kind: 'panorama',
      frameIds: ['f1', 'f2'],
    };
    albumUnreadable = true;
    await service.confirmMerge(card);
    albumUnreadable = false;
    found = [card];
    searches = 0;

    setVisibility('hidden');
    await new Promise((resolve) => setTimeout(resolve));
    expect(searches).toBe(0);

    setVisibility('visible');
    expect(searches).toBe(1); // coming back alone started it, before the other event arrives
    window.dispatchEvent(new Event('online'));
    await new Promise((resolve) => setTimeout(resolve));

    expect(searches).toBe(1);
    expect(writes).toEqual(['settleMerge:m1', 'dropFindings', 'refresh']);
  });

  /**
   * Networks come back in fits and starts, and "online" only means a network is there, not that
   * Lightroom answers. A retry that fails has to go back to waiting, or the first false start would
   * leave the card saying it will try again when nothing is ever going to.
   */
  it('goes back to waiting when a retry still cannot reach Lightroom, and retries again', async () => {
    const card: MergedPhoto = {
      mergedId: 'm1',
      mergedName: 'f1-Pano',
      kind: 'panorama',
      frameIds: ['f1', 'f2'],
    };
    const connectionReturns = async (): Promise<void> => {
      window.dispatchEvent(new Event('online'));
      await new Promise((resolve) => setTimeout(resolve));
    };
    albumUnreadable = true;
    await service.confirmMerge(card);
    searches = 0;

    await connectionReturns();

    expect(searches).toBe(1);
    expect(writes).toEqual([]);
    expect(service.state().get('m1')).toBe('unreachable');

    albumUnreadable = false;
    found = [card];

    await connectionReturns();

    expect(searches).toBe(2);
    expect(writes).toEqual(['settleMerge:m1', 'dropFindings', 'refresh']);
    expect(service.state().has('m1')).toBe(false);
  });

  /**
   * The tap was made about a file that may be gone by the time the retry runs. Lightroom's answer at
   * that moment is what counts, because confirming a deleted file would leave nothing to print and
   * the frames stood down. The refresh brings the sweep's row back.
   */
  it('saves nothing when the merged file is deleted while the card waits', async () => {
    const card: MergedPhoto = {
      mergedId: 'm1',
      mergedName: 'f1-Pano',
      kind: 'panorama',
      frameIds: ['f1', 'f2'],
    };
    albumUnreadable = true;
    await service.confirmMerge(card);
    albumUnreadable = false;
    found = [];
    searches = 0;

    window.dispatchEvent(new Event('online'));
    await new Promise((resolve) => setTimeout(resolve));

    expect(searches).toBe(1);
    expect(writes).toEqual(['refresh']);
    expect(service.state().has('m1')).toBe(false);
  });
});
