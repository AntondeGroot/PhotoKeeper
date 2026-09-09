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
  it('gives every photo its own link, and one into the album', async () => {
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
    const photos = [...root.querySelectorAll<HTMLAnchorElement>('.open-photo')];
    expect(photos.map((a) => a.textContent?.trim())).toEqual(['DSC_1 ↗', 'DSC_2 ↗']);
    expect(photos[0].getAttribute('href')).toContain('/search/assets/a1');
    expect(photos[0].getAttribute('target')).toBe('_blank');
    // The search that isolates the set, for removing them in one go.
    const together = root.querySelector('.open-album')?.getAttribute('href');
    expect(together).toContain('albumFilter=al-9');
    expect(together).toContain('DSC_1');
    expect(together).toContain('DSC_2');
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

  /** Both halves of the same residue, in one place: what an album holds wrongly, and what it lost. */
  it('carries the put-back panel too', async () => {
    await render();

    expect(root.querySelector('app-put-back')).not.toBeNull();
  });
});
