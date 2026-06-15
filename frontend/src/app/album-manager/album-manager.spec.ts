import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AlbumManagerComponent } from './album-manager';
import { Album } from '../lightroom.service';

const ALBUMS: Album[] = [
  { id: 'a1', name: 'Lisbon, May' },
  { id: 'a2', name: 'Field work' },
  { id: 'a3', name: 'Iceland 2025' },
];

function inputEvent(value: string): Event {
  return { target: { value } } as unknown as Event;
}

describe('AlbumManagerComponent', () => {
  describe('filtering (unit)', () => {
    let component: AlbumManagerComponent;

    beforeEach(() => {
      component = new AlbumManagerComponent();
      component.albums = ALBUMS;
    });

    it('returns all albums when there is no query or filter', () => {
      expect(component.filteredAlbums().map((a) => a.id)).toEqual(['a1', 'a2', 'a3']);
    });

    it('filters by case-insensitive name query', () => {
      component.onQuery(inputEvent('ice'));

      expect(component.filteredAlbums().map((a) => a.id)).toEqual(['a3']);
    });

    it('hides tagged albums when "untagged only" is on', () => {
      component.vacationAlbumIds = ['a1'];

      component.toggleUntagged();

      expect(component.filteredAlbums().map((a) => a.id)).toEqual(['a2', 'a3']);
    });

    it('isVacation reflects the tagged ids', () => {
      component.vacationAlbumIds = ['a2'];

      expect(component.isVacation('a2')).toBe(true);
      expect(component.isVacation('a1')).toBe(false);
    });
  });

  describe('outputs (rendered)', () => {
    let fixture: ComponentFixture<AlbumManagerComponent>;
    let component: AlbumManagerComponent;

    beforeEach(async () => {
      await TestBed.configureTestingModule({
        imports: [AlbumManagerComponent],
      }).compileComponents();
      fixture = TestBed.createComponent(AlbumManagerComponent);
      component = fixture.componentInstance;
      component.albums = ALBUMS;
      fixture.detectChanges();
    });

    it('emits the album id when its Vacation pill is clicked', () => {
      let emitted: string | undefined;
      component.toggleVacation.subscribe((id) => (emitted = id));

      const root = fixture.nativeElement as HTMLElement;
      root.querySelector<HTMLButtonElement>('.vacation-pill')?.click();

      expect(emitted).toBe('a1');
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
