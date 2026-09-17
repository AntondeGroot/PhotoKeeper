import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ReviewEditComponent } from './review-edit';
import { KeeperAlbumsService } from '../../keeper-albums.service';
import { KeeperFilingService } from '../keeper-filing.service';
import { EditCandidatesService } from '../edit-candidates.service';
import { EditDetectionService } from '../edit-detection.service';
import { MergedPhoto } from '../merged-photo';
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
  /** Merges the tab confirmed — what "That's the panorama" does. */
  let settled: string[];
  /** Mounts the Edit list against a catalog that either has the KeeperEdit album or hasn't. */
  async function render(
    editAlbumId: string | null,
    catalogId: string | null = 'cat-1',
    queue: { waiting: number; held: number } = { waiting: 0, held: 0 },
    editDone = false,
    overdue: { assetId: string; name: string; decidedAt: number }[] = [],
    merges: MergedPhoto[] = [],
  ) {
    settled = [];
    ensured = 0;
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [ReviewEditComponent],
      providers: [
        {
          provide: EditCandidatesService,
          useValue: { merges: signal(merges) },
        },
        {
          provide: EditDetectionService,
          useValue: {
            checking: signal(false),
            picking: signal(false),
            panelOpen: signal(false),
            check: () => Promise.resolve(),
            listQueue: () => Promise.resolve(),
            settleMerge: (merge: MergedPhoto) => {
              settled.push(merge.mergedId);
              return Promise.resolve();
            },
          },
        },
        {
          provide: KeeperFilingService,
          useValue: {
            editQueueWaiting: signal(queue.waiting),
            editQueueHeld: signal(queue.held),
            mandatoryEdits: signal(overdue),
          },
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
    fixture.componentRef.setInput('editDone', editDone);
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
   * Photos decided for editing that are deliberately not in Lightroom yet. Without a word about
   * them the app looks broken: you send ten to edit, and KeeperEdit shows two.
   */
  describe('when the album is over its limit', () => {
    /**
     * The album can sit over its limit for good: finished photos cannot be taken out of it, so the
     * only way down is to edit them and take them out by hand. That is the whole of the message —
     * the numbers are on the Settings card for anyone who wants them.
     */
    it('says the album is too full, and what to do about it', async () => {
      await render('al-9', 'cat-1', { waiting: 12, held: 400 });

      const note = root.querySelector('.queue-note')?.textContent ?? '';
      expect(note).toContain('KeeperEdit holds too many photos');
      expect(note).toContain('remove them from the album');
    });

    /** A queue draining as it should is not news: nothing is said until the album is over its limit. */
    it('says nothing while the album is under its limit', async () => {
      await render('al-9', 'cat-1', { waiting: 12, held: 20 });

      expect(root.querySelector('.queue-note')).toBeNull();
    });

    /**
     * The case that made the screen contradict itself: nothing left on this phone to edit, so the
     * tab said "Edit queue clear" — while KeeperEdit held four hundred photographs.
     */
    it('says so even when this phone has nothing left to edit', async () => {
      await render('al-9', 'cat-1', { waiting: 0, held: 400 }, true);

      expect(root.querySelector('.edit-done')).not.toBeNull(); // the queue here really is clear
      expect(root.querySelector('.queue-note')?.textContent).toContain('too many photos');
    });

    it('says nothing when the album is empty', async () => {
      await render('al-9');

      expect(root.querySelector('.queue-note')).toBeNull();
    });
  });

  /**
   * The photographs holding the album shut. Shown whether or not today's batch happens to contain
   * them — the batch is three photographs off the deck, and the ones being avoided are exactly the
   * ones that will not be in it.
   */
  describe('photographs that have waited over a month', () => {
    const overdue = [
      { assetId: 'stuck-1', name: 'DSC_0001.NEF', decidedAt: 1 },
      { assetId: 'stuck-2', name: 'DSC_0002.NEF', decidedAt: 2 },
    ];

    it('names them, and says what editing them is for', async () => {
      await render('al-9', 'cat-1', { waiting: 0, held: 5 }, false, overdue);

      const said = root.querySelector('.must-edit')?.textContent ?? '';
      expect(said).toContain('2 photos have been waiting over a month');
      expect(said).toContain('let new photos into KeeperEdit');
      expect(said).toContain('DSC_0001.NEF');
    });

    /** Straight to the photograph in Lightroom, which is where the editing actually happens. */
    it('offers a way into each one', async () => {
      await render('al-9', 'cat-1', { waiting: 0, held: 5 }, false, overdue);

      const link = root.querySelector<HTMLAnchorElement>('.must-open');
      expect(link?.getAttribute('href')).toContain('stuck-1');
      expect(link?.getAttribute('href')).toContain('DSC_0001.NEF');
    });

    /** Even when this phone has nothing left in today's batch — which is when it matters most. */
    it('says so when today’s batch is empty', async () => {
      await render('al-9', 'cat-1', { waiting: 0, held: 5 }, true, overdue);

      expect(root.querySelector('.must-edit')).not.toBeNull();
    });

    it('marks a batch row that is one of them', async () => {
      await render('al-9', 'cat-1', { waiting: 0, held: 5 }, false, [
        { assetId: 'IMG_1', name: 'IMG_1.NEF', decidedAt: 1 },
      ]);

      expect(root.querySelector('.must-badge')?.textContent?.trim()).toBe('waiting a month');
    });

    it('says nothing when nothing has waited that long', async () => {
      await render('al-9');

      expect(root.querySelector('.must-edit')).toBeNull();
      expect(root.querySelector('.must-badge')).toBeNull();
    });
  });

  /**
   * "Edit queue clear" is only true of the album as well as this phone. Said while KeeperEdit is
   * full — or holding photographs nobody has touched for a month — it reads as the app having lost
   * track of what it is doing.
   */
  describe('what "clear" is allowed to mean', () => {
    const heading = () => root.querySelector('.edit-done h2')?.textContent?.trim();

    it('is clear only when the album is neither full nor overdue', async () => {
      await render('al-9', 'cat-1', { waiting: 0, held: 5 }, true);

      expect(heading()).toBe('Edit queue clear.');
    });

    it('says the album is full rather than clear', async () => {
      await render('al-9', 'cat-1', { waiting: 0, held: 30 }, true);

      expect(heading()).toBe('Nothing new while KeeperEdit is full.');
    });

    /** The overdue ones outrank the count: they are the reason, and the way out. */
    it('points at the overdue photographs when there are some', async () => {
      await render('al-9', 'cat-1', { waiting: 0, held: 30 }, true, [
        { assetId: 'stuck', name: 'DSC_1.NEF', decidedAt: 1 },
      ]);

      expect(heading()).toBe('Nothing new until those are edited.');
    });
  });

  /**
   * A sweep Lightroom has already stitched. Its frames have quietly left the list of things to edit,
   * and until now the only place to say so was behind the "Check for edits" button — which you would
   * have to know to press.
   */
  describe('merges waiting to be confirmed', () => {
    const merge: MergedPhoto = {
      mergedId: 'm1',
      mergedName: 'DSC_6470-Pano',
      kind: 'panorama',
      frameIds: ['f1', 'f2', 'f3'],
    };

    it('names the merge and what it was made from', async () => {
      await render('al-9', 'cat-1', { waiting: 0, held: 5 }, false, [], [merge]);

      const said = root.querySelector('.merged-ready')?.textContent ?? '';
      expect(said).toContain('DSC_6470-Pano');
      expect(said).toContain('A panorama from 3 frames');
    });

    it('settles it when confirmed', async () => {
      await render('al-9', 'cat-1', { waiting: 0, held: 5 }, false, [], [merge]);

      root.querySelector<HTMLButtonElement>('.merged-done')?.click();

      expect(settled).toEqual(['m1']);
    });

    /** Especially then: the queue looks empty precisely because the work was done. */
    it('shows them when the queue is otherwise clear', async () => {
      await render('al-9', 'cat-1', { waiting: 0, held: 5 }, true, [], [merge]);

      expect(root.querySelector('.merged-ready')).not.toBeNull();
    });

    it('shows nothing when nothing has been merged', async () => {
      await render('al-9');

      expect(root.querySelector('.merged-ready')).toBeNull();
    });
  });
});
