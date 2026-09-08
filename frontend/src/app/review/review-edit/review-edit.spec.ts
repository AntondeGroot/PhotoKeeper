import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ReviewEditComponent } from './review-edit';
import { KeeperAlbumsService } from '../../keeper-albums.service';
import { KeeperFilingService } from '../keeper-filing.service';
import { Photo } from '../../photo';

const photo = (id: string): Photo => ({
  id,
  name: id,
  ext: 'CR2',
  album: 'Trip',
  taken: '2026-05-01',
  status: 'toEdit',
  kind: 'photo',
  starred: false,
  saveOnly: false,
});

/** Lets the tidy-up lookup — a chain of awaited store reads — settle before the DOM is inspected. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ReviewEditComponent', () => {
  let fixture: ComponentFixture<ReviewEditComponent>;
  let root: HTMLElement;
  let ensured: number;
  /** Filenames sitting in KeeperEdit whose verdict has moved on — what the tidy-up link targets. */
  let stale: string[];

  // Reset here rather than in render(), which a test calls *after* staging what it wants found.
  beforeEach(() => {
    stale = [];
  });

  /** Mounts the Edit list against a catalog that either has the KeeperEdit album or hasn't. */
  async function render(editAlbumId: string | null, catalogId: string | null = 'cat-1') {
    ensured = 0;
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [ReviewEditComponent],
      providers: [
        {
          provide: KeeperFilingService,
          useValue: { staleFilings: () => Promise.resolve(new Map([['KeeperEdit', stale]])) },
        },
        {
          provide: KeeperAlbumsService,
          useValue: {
            editAlbumId: signal(editAlbumId),
            idFor: () => editAlbumId,
            ensure: () => {
              ensured++;
              return Promise.resolve();
            },
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ReviewEditComponent);
    fixture.componentRef.setInput('queue', [photo('IMG_1')]);
    fixture.componentRef.setInput('catalogId', catalogId);
    fixture.detectChanges();
    root = fixture.nativeElement as HTMLElement;
  }

  function albumButton(): HTMLAnchorElement | null {
    return root.querySelector<HTMLAnchorElement>('.open-album');
  }

  it('offers a way into the whole album once the catalog has one', async () => {
    await render('al-9');

    expect(albumButton()?.textContent?.trim()).toBe('Open KeeperEdit in Lightroom →');
    expect(albumButton()?.getAttribute('href')).toBe(
      'https://lightroom.adobe.com/libraries/cat-1/albums/al-9/assets',
    );
    expect(albumButton()?.getAttribute('target')).toBe('_blank');
  });

  it('offers nothing when the catalog has no KeeperEdit album', async () => {
    // A door that opens on nothing is worse than no door — the per-photo links still work.
    await render(null);

    expect(albumButton()).toBeNull();
    expect(root.querySelectorAll('.open-lr')).toHaveLength(1);
  });

  it('offers nothing before the catalog id is known', async () => {
    await render('al-9', null);

    expect(albumButton()).toBeNull();
  });

  /**
   * That it asks, not how many times: KeeperAlbumsService.ensure joins an in-flight read rather than
   * repeating it, so every caller that needs the catalogue read can simply ask for it.
   */
  it('asks for the album check when it opens', async () => {
    await render('al-9');

    expect(ensured).toBeGreaterThan(0);
  });

  it('links each queued photo to itself in Lightroom, by search', async () => {
    await render(null);

    expect(root.querySelector('.open-lr')?.getAttribute('href')).toBe(
      'https://lightroom.adobe.com/libraries/cat-1/search/assets/IMG_1?q=IMG_1.CR2',
    );
  });

  /**
   * The queue's only exit, and it was missing: the button was dropped when the Lightroom links were
   * added (#158) while its @Output, the host binding and promoteToPrint all stayed. Nothing emitted
   * it, so a photo stayed 'toEdit' for ever — which also kept its album off the Prints tab, since
   * that counts a to-edit photo as unfinished.
   */
  /**
   * Two steps, because the button sits in a list beside a link: a mis-tap would send the wrong photo
   * out of the queue, and the queue's exit is one-way as far as the Edit tab is concerned.
   */
  it('asks before sending a photo out of the queue', async () => {
    await render('al-9');
    fixture.componentRef.setInput('queue', [photo('IMG_1'), photo('IMG_2')]);
    fixture.detectChanges();
    let promoted: string | null = null;
    fixture.componentInstance.promoted.subscribe((id: string) => (promoted = id));

    root.querySelectorAll<HTMLButtonElement>('.edit-done-btn')[1].click();
    fixture.detectChanges();

    expect(promoted).toBeNull(); // asked, not done
    expect(root.querySelector('.confirm-done')).not.toBeNull();
  });

  it('emits the photo once the confirm is pressed', async () => {
    await render('al-9');
    fixture.componentRef.setInput('queue', [photo('IMG_1'), photo('IMG_2')]);
    fixture.detectChanges();
    let promoted: string | null = null;
    fixture.componentInstance.promoted.subscribe((id: string) => (promoted = id));

    root.querySelectorAll<HTMLButtonElement>('.edit-done-btn')[1].click();
    fixture.detectChanges();
    root.querySelector<HTMLButtonElement>('.edit-done-btn.commit')?.click();

    expect(promoted).toBe('IMG_2');
  });

  /** The whole point: the way out of an accidental tap has to be easier than the way through it. */
  it('sends nothing when the ask is cancelled', async () => {
    await render('al-9');
    let promoted: string | null = null;
    fixture.componentInstance.promoted.subscribe((id: string) => (promoted = id));

    root.querySelector<HTMLButtonElement>('.edit-done-btn')?.click();
    fixture.detectChanges();
    root.querySelector<HTMLButtonElement>('.cancel-done')?.click();
    fixture.detectChanges();

    expect(promoted).toBeNull();
    expect(root.querySelector('.confirm-done')).toBeNull();
    expect(root.querySelector('.edit-done-btn')).not.toBeNull();
  });

  it('still offers the Lightroom link beside it — you edit there, then say so here', async () => {
    await render('al-9');

    expect(root.querySelector('.open-lr')).not.toBeNull();
    expect(root.querySelector('.edit-done-btn')).not.toBeNull();
  });

  /**
   * Lightroom lets the app put a photo into an album but never take it out, so KeeperEdit keeps
   * everything ever sent there — finished photos included. The same link mechanism the Settings
   * tidy-up uses is offered here, where the photos were sent from.
   */
  describe('clearing out what has moved on', () => {
    it('offers a link to exactly the photos that no longer belong', async () => {
      stale = ['DSC_1.NEF', 'DSC_2.NEF'];

      await render('al-9');
      await flush();
      fixture.detectChanges();

      expect(root.querySelector('.tidy-note')?.textContent).toContain('2 photos');
      const link = root.querySelector<HTMLAnchorElement>('.tidy-link');
      expect(link?.getAttribute('href')).toContain('DSC_1.NEF');
      expect(link?.getAttribute('href')).toContain('DSC_2.NEF');
    });

    it('says nothing when the album holds only what belongs there', async () => {
      await render('al-9');
      await flush();
      fixture.detectChanges();

      expect(root.querySelector('.tidy-note')).toBeNull();
    });
  });
});
