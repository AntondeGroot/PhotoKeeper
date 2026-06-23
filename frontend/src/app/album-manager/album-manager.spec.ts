import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AlbumManagerComponent } from './album-manager';
import { Album } from '../lightroom.service';
import { PreferencesService } from '../preferences.service';

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

  beforeEach(async () => {
    localStorage.clear(); // PreferencesService hydrates album tags from localStorage on construction
    await TestBed.configureTestingModule({ imports: [AlbumManagerComponent] }).compileComponents();
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
