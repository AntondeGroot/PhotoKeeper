import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PutBackComponent } from './put-back';
import { KeeperFilingService } from '../keeper-filing.service';

describe('PutBackComponent', () => {
  let fixture: ComponentFixture<PutBackComponent>;
  let root: HTMLElement;
  let gaps: { album: string; missing: string[]; deleted: number }[];
  /** Assets Lightroom no longer has: they cannot be put back, however hard we try. */
  let gone: Set<string>;
  let sent: { album: string; assetIds: readonly string[] }[];
  let readFails: boolean;
  /** How many photos land before the connection goes; null for a connection that holds. */
  let landsBeforeDrop: number | null;
  /** Runs as each photo is dealt with, so a test can look at the screen partway through. */
  let afterEachPhoto: (() => void) | null;

  beforeEach(() => {
    gaps = [];
    gone = new Set();
    sent = [];
    readFails = false;
    landsBeforeDrop = null;
    afterEachPhoto = null;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [PutBackComponent],
      providers: [
        {
          provide: KeeperFilingService,
          useValue: {
            filingGaps: () =>
              readFails ? Promise.reject(new Error('offline')) : Promise.resolve(gaps),
            putBack: (
              album: string,
              assetIds: readonly string[],
              onSettled?: (settled: number) => void,
            ) => {
              sent.push({ album, assetIds });
              if (landsBeforeDrop !== null) {
                return Promise.resolve({
                  filed: landsBeforeDrop,
                  gone: 0,
                  refused: 0,
                  untried: assetIds.slice(landsBeforeDrop),
                });
              }
              assetIds.forEach((_, i) => {
                onSettled?.(i + 1);
                afterEachPhoto?.();
              });
              const lostForGood = assetIds.filter((id) => gone.has(id)).length;
              return Promise.resolve({
                filed: assetIds.length - lostForGood,
                gone: lostForGood,
                refused: 0,
                untried: [],
              });
            },
          },
        },
      ],
    });
    fixture = TestBed.createComponent(PutBackComponent);
    fixture.detectChanges();
    root = fixture.nativeElement as HTMLElement;
  });

  const notes = () => [...root.querySelectorAll('.tidy-note')].map((n) => n.textContent?.trim());
  const buttons = () =>
    [...root.querySelectorAll<HTMLButtonElement>('.tidy-btn')].map((b) => b.textContent?.trim());

  async function press(label: string) {
    const button = [...root.querySelectorAll<HTMLButtonElement>('.tidy-btn')].find((b) =>
      b.textContent?.includes(label),
    );
    button?.click();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('offers to look, and claims nothing before it has', () => {
    expect(buttons()).toContain('Check the Keeper albums');
    expect(notes().join(' ')).not.toContain('still where it put it');
  });

  it('reports each album that has lost photos', async () => {
    gaps = [
      { album: 'KeeperDelete', missing: ['a', 'b'], deleted: 0 },
      { album: 'KeeperEdit', missing: ['c'], deleted: 0 },
    ];

    await press('Check');

    expect([...root.querySelectorAll('.tidy-album')].map((e) => e.textContent)).toEqual([
      'KeeperDelete',
      'KeeperEdit',
    ]);
    expect(buttons()).toContain('Put 3 back');
  });

  /** "Nothing was lost" and "we have not looked" must not read the same. */
  it('says so plainly when nothing is missing', async () => {
    await press('Check');

    expect(notes().join(' ')).toContain('still where it put it');
  });

  it('files every album’s losses back where they belong', async () => {
    gaps = [
      { album: 'KeeperDelete', missing: ['a', 'b'], deleted: 0 },
      { album: 'KeeperEdit', missing: ['c'], deleted: 0 },
    ];
    await press('Check');

    await press('Put 3 back');

    expect(sent).toEqual([
      { album: 'KeeperDelete', assetIds: ['a', 'b'] },
      { album: 'KeeperEdit', assetIds: ['c'] },
    ]);
    expect(notes().join(' ')).toContain('Put 3 back');
  });

  /**
   * A photo that will not go back is one Lightroom genuinely no longer has. That is a different fact
   * from "put back", and the only person who can tell whether it is a surprise is the user.
   */
  it('distinguishes the ones that really were deleted', async () => {
    gaps = [{ album: 'KeeperDelete', missing: ['a', 'b'], deleted: 0 }];
    gone = new Set(['b']);
    await press('Check');

    await press('Put 2 back');

    expect(notes().join(' ')).toContain('Put 1 back');
    expect(notes().join(' ')).toContain('1 no longer in Lightroom');
  });

  /**
   * A run cut short has to leave the screen able to finish the job. The next album is left alone,
   * since the connection is gone, and the button then sends only what was not reached.
   */
  it('shows what is left after a dropped connection, and carries on from there', async () => {
    gaps = [
      { album: 'KeeperDelete', missing: ['a', 'b', 'c'], deleted: 0 },
      { album: 'KeeperEdit', missing: ['d'], deleted: 0 },
    ];
    landsBeforeDrop = 1;
    await press('Check');

    await press('Put 4 back');

    expect(notes().join(' ')).toContain('Put 1 back');
    expect(notes().join(' ')).toContain('connection dropped');
    expect(buttons()).toContain('Put 3 back');
    expect(sent).toEqual([{ album: 'KeeperDelete', assetIds: ['a', 'b', 'c'] }]);

    landsBeforeDrop = null;
    sent = [];
    await press('Put 3 back');

    expect(sent).toEqual([
      { album: 'KeeperDelete', assetIds: ['b', 'c'] },
      { album: 'KeeperEdit', assetIds: ['d'] },
    ]);
    expect(notes().join(' ')).not.toContain('connection dropped');
  });

  /**
   * Several minutes behind a button that only said "Putting back…" looked like it had hung. The count
   * runs across albums, so it has to keep climbing into the second one rather than start again.
   */
  it('counts up on the button as photos are dealt with, across albums', async () => {
    gaps = [
      { album: 'KeeperDelete', missing: ['a', 'b'], deleted: 0 },
      { album: 'KeeperEdit', missing: ['c'], deleted: 0 },
    ];
    await press('Check');
    const seen: (string | undefined)[] = [];
    afterEachPhoto = () => {
      fixture.detectChanges();
      seen.push(buttons()[0]);
    };

    await press('Put 3 back');

    expect(seen).toEqual(['Putting back… 1 of 3', 'Putting back… 2 of 3', 'Putting back… 3 of 3']);
  });

  /**
   * The finding that made this necessary, from the live API: deleting a photo leaves a tombstone in
   * the album under a new id, so on a real KeeperDelete 49 correctly-deleted photos read as missing.
   * Urging someone to put those back would undo the very work the app exists to help them finish.
   */
  it('reports deletions as done, not as something to put back', async () => {
    gaps = [{ album: 'KeeperDelete', missing: [], deleted: 49 }];

    await press('Check');

    expect(notes().join(' ')).toContain('49 already deleted');
    expect(buttons()).not.toContain('Put 49 back');
    expect(root.querySelectorAll('.tidy-album')).toHaveLength(0);
  });

  it('offers to put back only what was actually lost', async () => {
    gaps = [{ album: 'KeeperDelete', missing: ['a', 'b'], deleted: 49 }];

    await press('Check');

    expect(buttons()).toContain('Put 2 back');
    expect(notes().join(' ')).toContain('49 already deleted');
  });

  it('says when the albums could not be read, rather than that nothing is missing', async () => {
    readFails = true;

    await press('Check');

    expect(notes().join(' ')).toContain('Couldn’t read your albums');
  });
});
