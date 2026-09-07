import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ReviewEditComponent } from './review-edit';
import { KeeperAlbumsService } from '../../keeper-albums.service';
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

describe('ReviewEditComponent', () => {
  let fixture: ComponentFixture<ReviewEditComponent>;
  let root: HTMLElement;
  let ensured: number;

  /** Mounts the Edit list against a catalog that either has the KeeperEdit album or hasn't. */
  async function render(editAlbumId: string | null, catalogId: string | null = 'cat-1') {
    ensured = 0;
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [ReviewEditComponent],
      providers: [
        {
          provide: KeeperAlbumsService,
          useValue: {
            editAlbumId: signal(editAlbumId),
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

  it('asks for the album check when it opens', async () => {
    await render('al-9');

    expect(ensured).toBe(1);
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
  it('emits the photo when its Done editing button is pressed', async () => {
    await render('al-9');
    fixture.componentRef.setInput('queue', [photo('IMG_1'), photo('IMG_2')]);
    fixture.detectChanges();
    let promoted: string | null = null;
    fixture.componentInstance.promoted.subscribe((id: string) => (promoted = id));

    root.querySelectorAll<HTMLButtonElement>('.edit-done-btn')[1].click();

    expect(promoted).toBe('IMG_2');
  });

  it('still offers the Lightroom link beside it — you edit there, then say so here', async () => {
    await render('al-9');

    expect(root.querySelector('.open-lr')).not.toBeNull();
    expect(root.querySelector('.edit-done-btn')).not.toBeNull();
  });
});
