import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PrintPickerComponent } from './print-picker';
import { PreviewCacheService } from '../../review/preview-cache.service';
import { AlbumGroup, Photo } from '../../photo';

const photo = (id: string): Photo => ({
  id,
  name: id,
  album: 'Trip',
  taken: '2026-01-01',
  status: 'kept',
  kind: 'photo',
  starred: false,
  saveOnly: false,
});

/**
 * A stand-in for the grid element. jsdom does no layout, so the scroll geometry the component reads
 * has to be handed to it — 300px of window onto 1200px of grid.
 */
const grid = (scrollTop: number): HTMLElement =>
  ({ scrollTop, clientHeight: 300, scrollHeight: 1200 }) as HTMLElement;

describe('PrintPickerComponent', () => {
  let fixture: ComponentFixture<PrintPickerComponent>;
  let root: HTMLElement;

  async function render(count: number): Promise<PrintPickerComponent> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [PrintPickerComponent],
      providers: [
        // Previews are a network+IndexedDB read; this test is about how many tiles are asked for.
        {
          provide: PreviewCacheService,
          useValue: { ensure: () => Promise.resolve(), url: () => null, unavailable: () => false },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(PrintPickerComponent);
    const album: AlbumGroup = {
      album: 'Trip',
      photos: Array.from({ length: count }, (_, i) => photo(`p${i}`)),
    };
    fixture.componentRef.setInput('album', album);
    fixture.detectChanges();
    root = fixture.nativeElement as HTMLElement;
    return fixture.componentInstance;
  }

  const tiles = () => root.querySelectorAll('.pick').length;

  it('reveals another page of photos only once the grid is scrolled to its end', async () => {
    const component = await render(60);
    expect(tiles()).toBe(24);

    // Halfway down is not the end: revealing there would fetch previews for photos nobody has
    // reached yet, which is the cost this paging exists to avoid.
    component.revealMore(grid(400));
    fixture.detectChanges();
    expect(tiles()).toBe(24);

    component.revealMore(grid(900));
    fixture.detectChanges();
    expect(tiles()).toBe(48);
  });
});
