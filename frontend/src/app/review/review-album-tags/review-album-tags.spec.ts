import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReviewAlbumTagsComponent } from './review-album-tags';
import { PreferencesService } from '../../preferences.service';
import { CatalogScanService } from '../../detection/scan/catalog-scan.service';
import { ReviewDecisionsService } from '../review-decisions.service';

const ALBUM = 'Houten';

describe('ReviewAlbumTagsComponent', () => {
  let fixture: ComponentFixture<ReviewAlbumTagsComponent>;
  let component: ReviewAlbumTagsComponent;
  let prefs: PreferencesService;
  let invalidated: string[]; // albums whose change-gate manifest was dropped
  let withdrawn: string[]; // albums pulled out of today's deck

  /** The rendered pill, or null when the control chooses not to show itself. */
  function pill(): HTMLButtonElement | null {
    return (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.stereo-pill');
  }

  beforeEach(async () => {
    localStorage.clear(); // PreferencesService hydrates album tags from localStorage on construction
    invalidated = [];
    withdrawn = [];
    // Stubbed so this stays a unit test: the real services reach Lightroom over HTTP and IndexedDB.
    await TestBed.configureTestingModule({
      imports: [ReviewAlbumTagsComponent],
      providers: [
        {
          provide: CatalogScanService,
          useValue: {
            invalidateAlbumByName: (name: string) => {
              invalidated.push(name);
              return Promise.resolve();
            },
          },
        },
        {
          provide: ReviewDecisionsService,
          useValue: { withdrawAlbum: (name: string) => withdrawn.push(name) },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ReviewAlbumTagsComponent);
    component = fixture.componentInstance;
    prefs = TestBed.inject(PreferencesService);
    prefs.stereoEnabled.set(true);
    fixture.componentRef.setInput('album', ALBUM);
    fixture.detectChanges();
  });

  describe('when it shows at all', () => {
    it('stays hidden while the stereo tools feature is off', () => {
      prefs.stereoEnabled.set(false);
      fixture.detectChanges();

      expect(pill()).toBeNull();
    });

    it('stays hidden for a photo with no album, since stereo is keyed by album name', () => {
      fixture.componentRef.setInput('album', null);
      fixture.detectChanges();

      expect(pill()).toBeNull();
    });
  });

  describe('tagging the album', () => {
    it("marks the current photo's album, by name", () => {
      pill()?.click();

      expect(prefs.stereoAlbums()).toEqual([ALBUM]);
    });

    it('re-detects the album and pulls its remaining frames out of today', () => {
      pill()?.click();

      // Without the manifest drop the change gate would skip the album forever; without the
      // withdrawal its frames stay in the deck to be judged one eye at a time.
      expect(invalidated).toEqual([ALBUM]);
      expect(withdrawn).toEqual([ALBUM]);
    });

    it('reads back as tagged, and says so on the pill', () => {
      pill()?.click();
      fixture.detectChanges();

      expect(component.isStereo()).toBe(true);
      expect(pill()?.textContent).toContain('Stereo album');
    });
  });

  describe('removing the tag', () => {
    beforeEach(() => {
      prefs.stereoAlbums.set([ALBUM]);
      fixture.detectChanges();
      invalidated = [];
      withdrawn = [];
    });

    it('untags the album', () => {
      pill()?.click();

      expect(prefs.stereoAlbums()).toEqual([]);
    });

    it('re-detects it too, so the stereo groups do not outlive the tag', () => {
      pill()?.click();

      expect(invalidated).toEqual([ALBUM]);
    });

    it('withdraws nothing — there is nothing to take out of the deck', () => {
      pill()?.click();

      expect(withdrawn).toEqual([]);
    });
  });

  it('leaves the tags on other albums alone', () => {
    prefs.stereoAlbums.set(['Lisbon, May']);
    fixture.detectChanges();

    pill()?.click();

    expect(prefs.stereoAlbums()).toEqual(['Lisbon, May', ALBUM]);
  });
});
