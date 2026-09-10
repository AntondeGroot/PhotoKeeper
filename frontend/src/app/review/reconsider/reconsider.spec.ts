import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { SafeUrl } from '@angular/platform-browser';
import { ReconsiderComponent } from './reconsider';
import { DecidedPhoto, ReconsiderService } from '../reconsider.service';
import { VERDICT_STYLE } from '../../verdicts';

describe('ReconsiderComponent', () => {
  let fixture: ComponentFixture<ReconsiderComponent>;
  let root: HTMLElement;
  let photos: DecidedPhoto[];
  let asked: string[];
  let written: { assetId: string; status: string }[];
  let readFails: boolean;
  let thumbnails: ReturnType<typeof signal<ReadonlyMap<string, SafeUrl>>>;
  let released: number;

  beforeEach(() => {
    photos = [];
    asked = [];
    written = [];
    readFails = false;
    released = 0;
    thumbnails = signal<ReadonlyMap<string, SafeUrl>>(new Map());

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ReconsiderComponent],
      providers: [
        {
          provide: ReconsiderService,
          useValue: {
            thumbnails,
            photosIn: (album: string) => {
              asked.push(album);
              return readFails ? Promise.reject(new Error('offline')) : Promise.resolve(photos);
            },
            reverdict: (assetId: string, status: string) => {
              written.push({ assetId, status });
              return Promise.resolve();
            },
            loadThumbnails: () => Promise.resolve(),
            release: () => released++,
          },
        },
      ],
    });
    fixture = TestBed.createComponent(ReconsiderComponent);
    fixture.detectChanges();
    root = fixture.nativeElement as HTMLElement;
  });

  const buttons = () =>
    [...root.querySelectorAll<HTMLButtonElement>('button')].map((b) => b.textContent?.trim());

  async function openDelete() {
    const open = [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes('KeeperDelete'),
    );
    open?.click();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function chooseFirst() {
    root.querySelector<HTMLButtonElement>('.tile')?.click();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('offers the albums the app files decisions into', () => {
    expect(buttons()).toEqual(['Look through KeeperDelete', 'Look through KeeperEdit']);
  });

  /**
   * One flag for two buttons made both say "Opening…" on either tap, which reads as the app having
   * heard the wrong one — the single thing a button pressed on a phone must never look like.
   */
  it('reports only the button that was pressed', async () => {
    let release: (photos: DecidedPhoto[]) => void = () => {
      /* replaced by the promise below */
    };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ReconsiderComponent],
      providers: [
        {
          provide: ReconsiderService,
          useValue: {
            thumbnails,
            photosIn: () => new Promise<DecidedPhoto[]>((resolve) => (release = resolve)),
            loadThumbnails: () => Promise.resolve(),
            release: () => undefined,
            reverdict: () => Promise.resolve(),
          },
        },
      ],
    });
    fixture = TestBed.createComponent(ReconsiderComponent);
    fixture.detectChanges();
    root = fixture.nativeElement as HTMLElement;

    root.querySelectorAll<HTMLButtonElement>('button')[0].click(); // KeeperDelete
    fixture.detectChanges();

    expect(buttons()).toEqual(['Opening…', 'Look through KeeperEdit']);

    release([]);
    await fixture.whenStable();
  });

  it('shows what the chosen album holds', async () => {
    photos = [
      { assetId: 'a', name: 'DSC_1.NEF', status: 'rejected' },
      { assetId: 'b', name: 'DSC_2.NEF', status: 'rejected' },
    ];

    await openDelete();

    expect(asked).toEqual(['KeeperDelete']);
    expect(root.querySelectorAll('.tile')).toHaveLength(2);
  });

  /** Deciding again is the point, and a thumbnail in a grid is not enough to decide anything from. */
  it('offers the four verdicts once a photo is chosen, saying what it is now', async () => {
    photos = [{ assetId: 'a', name: 'DSC_1.NEF', status: 'rejected' }];
    await openDelete();

    await chooseFirst();

    expect(root.textContent).toContain('DSC_1.NEF — currently to delete');
    expect([...root.querySelectorAll('.verdict-btn')].map((b) => b.textContent?.trim())).toEqual([
      'Keep',
      'Edit',
      'Maybe',
      'Reject',
    ]);
  });

  /** Amber for Edit, as the review card's ↑ and the viewer both state it. A fourth colour for the
   *  same answer would read as a different answer. */
  it('colours the verdicts as the rest of the app does', async () => {
    photos = [{ assetId: 'a', name: 'DSC_1.NEF', status: 'rejected' }];
    await openDelete();
    await chooseFirst();

    // The colours come from the shared verdict description, so this asserts the colours themselves
    // rather than class names that would have to be mapped back to a colour somewhere else.
    expect(
      [...root.querySelectorAll<HTMLElement>('.verdict-btn')].map((b) => b.style.color),
    ).toEqual([
      VERDICT_STYLE.kept.colour,
      VERDICT_STYLE.toEdit.colour,
      VERDICT_STYLE.maybe.colour,
      VERDICT_STYLE.rejected.colour,
    ]);
  });

  it('writes the new verdict and takes the photo out of the grid', async () => {
    photos = [
      { assetId: 'a', name: 'DSC_1.NEF', status: 'rejected' },
      { assetId: 'b', name: 'DSC_2.NEF', status: 'rejected' },
    ];
    await openDelete();
    await chooseFirst();

    root.querySelector<HTMLButtonElement>('.verdict-btn')?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(written).toEqual([{ assetId: 'a', status: 'kept' }]);
    // Back to the grid, one lighter: it no longer belongs to the album being looked through.
    expect(root.querySelectorAll('.tile')).toHaveLength(1);
    expect(root.textContent).toContain('DSC_1.NEF is now kept');
  });

  it('backs out of a photo without deciding anything', async () => {
    photos = [{ assetId: 'a', name: 'DSC_1.NEF', status: 'rejected' }];
    await openDelete();
    await chooseFirst();

    [...root.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent?.includes('Back to'))
      ?.click();
    fixture.detectChanges();

    expect(written).toEqual([]);
    expect(root.querySelectorAll('.tile')).toHaveLength(1);
  });

  it('says when the album could not be read, rather than showing an empty one', async () => {
    readFails = true;

    await openDelete();

    expect(root.textContent).toContain('Couldn’t read KeeperDelete');
  });

  /** The pictures are object URLs; leaving the grid has to hand them back. */
  it('releases the pictures when the grid is closed', async () => {
    photos = [{ assetId: 'a', name: 'DSC_1.NEF', status: 'rejected' }];
    await openDelete();
    const onOpen = released;

    [...root.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent?.trim() === 'Done')
      ?.click();
    fixture.detectChanges();

    expect(released).toBeGreaterThan(onOpen);
    expect(buttons()).toContain('Look through KeeperDelete');
  });
});
