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

  beforeEach(() => {
    gaps = [];
    gone = new Set();
    sent = [];
    readFails = false;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [PutBackComponent],
      providers: [
        {
          provide: KeeperFilingService,
          useValue: {
            filingGaps: () =>
              readFails ? Promise.reject(new Error('offline')) : Promise.resolve(gaps),
            fileSet: (album: string, assetIds: readonly string[]) => {
              sent.push({ album, assetIds });
              return Promise.resolve(assetIds.filter((id) => !gone.has(id)).length);
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
    expect(notes().join(' ')).toContain('1 could not be');
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
