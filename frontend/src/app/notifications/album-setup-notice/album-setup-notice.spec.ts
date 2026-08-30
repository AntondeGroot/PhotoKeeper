import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';
import { AlbumSetupNoticeComponent, REQUIRED_ALBUMS } from './album-setup-notice';
import { LightroomService } from '../../lightroom.service';

/** The catalog's albums, as the notice asks for them — only the names matter to it. */
function catalog(...names: string[]): Observable<{ id: string; name: string }[]> {
  return of(names.map((name, i) => ({ id: `al-${i}`, name })));
}

describe('AlbumSetupNoticeComponent', () => {
  let fixture: ComponentFixture<AlbumSetupNoticeComponent>;
  let root: HTMLElement;

  /** Mounts the notice against a catalog, and lets its own album fetch settle. */
  async function mount(albums: Observable<{ id: string; name: string }[]>): Promise<void> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [AlbumSetupNoticeComponent],
      providers: [{ provide: LightroomService, useValue: { getAlbums: () => albums } }],
    }).compileComponents();
    fixture = TestBed.createComponent(AlbumSetupNoticeComponent);
    fixture.detectChanges(); // ngOnInit starts the check
    await fixture.whenStable();
    fixture.detectChanges();
    root = fixture.nativeElement as HTMLElement;
  }

  function listed(): string[] {
    return Array.from(root.querySelectorAll('.setup-notice__name')).map(
      (n) => n.textContent?.trim() ?? '',
    );
  }

  it('asks for the albums the catalog is missing, and only those', async () => {
    await mount(catalog('Holiday', 'KeeperEdit'));

    expect(root.querySelector('.setup-notice')).not.toBeNull();
    expect(listed()).toEqual(['KeeperDelete', 'KeeperPrint']); // KeeperEdit already exists
  });

  it('says nothing once all three albums exist', async () => {
    await mount(catalog(...REQUIRED_ALBUMS.map((a) => a.name)));

    expect(root.querySelector('.setup-notice')).toBeNull();
  });

  it('stays hidden when the catalog cannot be read', async () => {
    // A failed fetch says nothing about the albums, and a notice that nags on a dropped connection
    // teaches people to dismiss it without reading.
    await mount(throwError(() => new Error('offline')));

    expect(root.querySelector('.setup-notice')).toBeNull();
  });

  it('names each missing album with what it is for', async () => {
    await mount(catalog());

    const purposes = Array.from(root.querySelectorAll('.setup-notice__purpose')).map((p) =>
      p.textContent?.trim(),
    );
    expect(purposes).toEqual(REQUIRED_ALBUMS.map((a) => a.purpose));
  });

  it('OK dismisses it for the session', async () => {
    // Nothing is persisted on purpose: it re-checks on the next launch and comes back if the albums
    // are still missing.
    await mount(catalog());

    root.querySelector<HTMLButtonElement>('.setup-notice__ok')?.click();
    fixture.detectChanges();

    expect(root.querySelector('.setup-notice')).toBeNull();
  });
});
