import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AlbumManagerComponent } from './album-manager';
import { Album } from '../lightroom.service';
import { PreferencesService } from '../preferences.service';
import { CatalogScanService } from '../detection/scan/catalog-scan.service';
import { ReviewDecisionsService } from '../review/review-decisions.service';

const ALBUMS: Album[] = [
  { id: 'a1', name: 'Lisbon, May' },
  { id: 'a2', name: 'Field work' },
  { id: 'a3', name: 'Iceland 2025' },
];

function inputEvent(value: string): Event {
  return { target: { value } } as unknown as Event;
}

describe('AlbumManagerComponent', () => {
  let fixture: ComponentFixture<AlbumManagerComponent>;
  let component: AlbumManagerComponent;
  let prefs: PreferencesService;
  let invalidated: string[]; // albums whose change-gate manifest was dropped
  let withdrawn: string[]; // albums pulled out of today's deck

  beforeEach(async () => {
    localStorage.clear(); // PreferencesService hydrates album tags from localStorage on construction
    invalidated = [];
    withdrawn = [];
    // Stubbed so the unit test stays one: the real services reach Lightroom over HTTP and IndexedDB.
    await TestBed.configureTestingModule({
      imports: [AlbumManagerComponent],
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
          useValue: { withdrawAlbum: (n: string) => withdrawn.push(n) },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AlbumManagerComponent);
    component = fixture.componentInstance;
    prefs = TestBed.inject(PreferencesService);
    component.albums = ALBUMS;
    fixture.detectChanges();
  });

  describe('filtering', () => {
    it('returns all albums when there is no query or filter', () => {
      expect(component.filteredAlbums().map((a) => a.id)).toEqual(['a1', 'a2', 'a3']);
    });

    it('filters by case-insensitive name query', () => {
      component.onQuery(inputEvent('ice'));
      expect(component.filteredAlbums().map((a) => a.id)).toEqual(['a3']);
    });

    it('hides tagged albums when "untagged only" is on', () => {
      prefs.vacationAlbumIds.set(['a1']);
      component.toggleUntagged();
      expect(component.filteredAlbums().map((a) => a.id)).toEqual(['a2', 'a3']);
    });

    it('isVacation reflects the tagged ids', () => {
      prefs.vacationAlbumIds.set(['a2']);
      expect(component.isVacation('a2')).toBe(true);
      expect(component.isVacation('a1')).toBe(false);
    });
  });

  describe('marking (rendered)', () => {
    it('tags the album as vacation when its pill is clicked', () => {
      const root = fixture.nativeElement as HTMLElement;
      root.querySelector<HTMLButtonElement>('.vacation-pill')?.click();
      expect(prefs.vacationAlbumIds()).toContain('a1');
    });

    it('shows the Stereo pill only when stereo tools are enabled', () => {
      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelector('.stereo-pill')).toBeNull();

      prefs.stereoEnabled.set(true);
      fixture.detectChanges();
      expect(root.querySelector('.stereo-pill')).not.toBeNull();
    });

    it('marks the album as stereo (by name) when its pill is clicked', () => {
      prefs.stereoEnabled.set(true);
      fixture.detectChanges();

      const root = fixture.nativeElement as HTMLElement;
      root.querySelector<HTMLButtonElement>('.stereo-pill')?.click();
      expect(prefs.stereoAlbums()).toContain('Lisbon, May'); // a1's name — stereo is name-keyed
    });

    it('re-detects the album and pulls its frames from today when tagged stereo', () => {
      prefs.stereoEnabled.set(true);
      fixture.detectChanges();
      const root = fixture.nativeElement as HTMLElement;

      root.querySelector<HTMLButtonElement>('.stereo-pill')?.click();

      // Without the manifest drop the change gate would skip the album forever, and its frames would
      // stay in today's deck to be judged one eye at a time.
      expect(invalidated).toEqual(['Lisbon, May']);
      expect(withdrawn).toEqual(['Lisbon, May']);
    });

    it('re-detects but withdraws nothing when the stereo tag is removed', () => {
      prefs.stereoEnabled.set(true);
      prefs.stereoAlbums.set(['Lisbon, May']);
      fixture.detectChanges();
      const root = fixture.nativeElement as HTMLElement;

      root.querySelector<HTMLButtonElement>('.stereo-pill')?.click();

      expect(prefs.stereoAlbums()).not.toContain('Lisbon, May');
      expect(invalidated).toEqual(['Lisbon, May']); // stale stereo groups must not outlive the tag
      expect(withdrawn).toEqual([]); // nothing to take out of the deck
    });

    it('emits back when the back button is clicked', () => {
      let backed = false;
      component.back.subscribe(() => (backed = true));

      const root = fixture.nativeElement as HTMLElement;
      root.querySelector<HTMLButtonElement>('.back-btn')?.click();
      expect(backed).toBe(true);
    });

    it('shows an empty message when nothing matches the query', () => {
      component.onQuery(inputEvent('zzz'));
      fixture.detectChanges();

      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelector('.album-empty')?.textContent).toContain('No albums match');
    });
  });
});
