import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { TidyComponent } from './tidy';
import { KeeperAlbumsService } from '../../keeper-albums.service';
import { KeeperFilingService } from '../keeper-filing.service';

/** Lets the chain of awaited store reads in the constructor settle before the DOM is inspected. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('TidyComponent', () => {
  let fixture: ComponentFixture<TidyComponent>;
  let root: HTMLElement;
  let stale: Map<string, { assetId: string; name: string }[]>;
  let albumId: string | null;

  async function render(catalogId: string | null = 'cat-1') {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [TidyComponent],
      providers: [
        {
          provide: KeeperFilingService,
          useValue: {
            staleInAlbums: () => Promise.resolve(stale),
            // The put-back half is its own component with its own spec; here it must simply mount.
            filingGaps: () => Promise.resolve([]),
            fileSet: () => Promise.resolve(0),
          },
        },
        {
          provide: KeeperAlbumsService,
          useValue: {
            ensure: () => Promise.resolve(),
            idFor: () => albumId,
            editAlbumId: signal(albumId),
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(TidyComponent);
    fixture.componentRef.setInput('catalogId', catalogId);
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();
    root = fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    stale = new Map();
    albumId = 'al-9';
  });

  /**
   * A link per photo, not one search naming them all. Lightroom's album search cannot find every file
   * by name — one imported as `2021-05-24-DSC_4390.NEF` is findable by no form of it — so the screen
   * said four photos and the link opened on three. An asset id in the path always resolves.
   */
  it('gives every photo its own link, and both ways into the album', async () => {
    stale = new Map([
      [
        'KeeperEdit',
        [
          { assetId: 'a1', name: 'DSC_1' },
          { assetId: 'a2', name: 'DSC_2' },
        ],
      ],
    ]);

    await render();

    expect(root.querySelector('.tidy-album')?.textContent).toBe('KeeperEdit');
    expect(root.querySelector('.tidy-count')?.textContent).toContain('2 to remove');
    expect([...root.querySelectorAll('.copy-name')].map((b) => b.textContent?.trim())).toEqual([
      'DSC_1',
      'DSC_2',
    ]);
    const photos = [...root.querySelectorAll<HTMLAnchorElement>('.open-photo')];
    expect(photos[0].getAttribute('href')).toContain('/search/assets/a1');
    expect(photos[0].getAttribute('target')).toBe('_blank');
    // Two doors, and Lightroom does a different thing behind each — see linksFor.
    const doors = [...root.querySelectorAll<HTMLAnchorElement>('.open-album')].map((a) =>
      a.getAttribute('href'),
    );
    expect(doors[0]).toContain('/albums/al-9/assets'); // where "remove from this album" lives
    expect(doors[1]).toContain('albumFilter=al-9'); // the search: just these, but delete only
    expect(doors[1]).toContain('DSC_1');
    expect(doors[1]).toContain('DSC_2');
  });

  it('says so when there is nothing sitting where it should not be', async () => {
    await render();

    expect(root.querySelectorAll('.tidy-row')).toHaveLength(0);
    expect(root.textContent).toContain('Nothing is sitting in an album it has moved on from');
  });

  /** A door that opens on nothing is worse than no door. */
  it('offers no link for an album the catalogue does not have', async () => {
    stale = new Map([['KeeperEdit', [{ assetId: 'a1', name: 'DSC_1' }]]]);
    albumId = null;

    await render();

    expect(root.querySelectorAll('.tidy-row')).toHaveLength(0);
  });

  it('claims nothing before the catalogue id is known', async () => {
    stale = new Map([['KeeperEdit', [{ assetId: 'a1', name: 'DSC_1' }]]]);

    await render(null);

    expect(root.querySelectorAll('.tidy-row')).toHaveLength(0);
    // Not "nothing to tidy" either — it has not been able to look.
    expect(root.textContent).not.toContain('Nothing is sitting');
  });

  /**
   * The Lightroom app is where removing a set is comfortable — long-press to select, remove or
   * delete the lot — but it takes no link to a filtered set, so it has to be opened by hand. The one
   * thing worth handing over is what to paste into its search.
   */
  /**
   * One name at a time, because that is all the app's search takes: a comma-joined list finds
   * nothing there, and a space-separated pair still returns one photo. Both were tried against it.
   */
  describe('copying a name', () => {
    let written: string[];

    beforeEach(() => {
      written = [];
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: (text: string) => {
            written.push(text);
            return Promise.resolve();
          },
        },
        configurable: true,
      });
    });

    async function pressCopy() {
      stale = new Map([
        [
          'KeeperEdit',
          [
            { assetId: 'a1', name: 'DSC_1' },
            { assetId: 'a2', name: 'DSC_2' },
          ],
        ],
      ]);
      await render();
      root.querySelector<HTMLButtonElement>('.copy-name')?.click();
      await fixture.whenStable();
      fixture.detectChanges();
    }

    it('copies the one name, which is all the app can search for', async () => {
      await pressCopy();

      expect(written).toEqual(['DSC_1']);
    });

    /** A clipboard write is invisible; without a word back, the tap looks like it did nothing. */
    it('says it worked', async () => {
      await pressCopy();

      expect(root.querySelector('.copy-name')?.textContent?.trim()).toBe('copied ✓');
    });

    /**
     * The modern API wants a secure context and a trusted gesture and refuses without either, which
     * an embedded webview hits easily. The old selection dance has neither requirement.
     */
    it('falls back to the selection copy when the clipboard API refuses', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: () => Promise.reject(new Error('denied')) },
        configurable: true,
      });
      let selected = '';
      const execCommand = vi.fn(() => {
        selected = document.querySelector('textarea')?.value ?? '';
        return true;
      });
      Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });

      await pressCopy();

      expect(selected).toBe('DSC_1');
      expect(root.querySelector('.copy-name')?.textContent?.trim()).toBe('copied ✓');
      // And it tidies up after itself rather than leaving a field on the page.
      expect(document.querySelector('textarea')).toBeNull();
    });

    it('says nothing it cannot back up when neither way works', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: () => Promise.reject(new Error('denied')) },
        configurable: true,
      });
      Object.defineProperty(document, 'execCommand', { value: () => false, configurable: true });

      await pressCopy();

      expect(root.querySelector('.copy-name')?.textContent?.trim()).toBe('DSC_1');
    });
  });

  /** Both halves of the same residue, in one place: what an album holds wrongly, and what it lost. */
  it('carries the put-back panel too', async () => {
    await render();

    expect(root.querySelector('app-put-back')).not.toBeNull();
  });
});
