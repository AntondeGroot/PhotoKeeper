import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PanoCardComponent } from './pano-card';
import { Pano, PanoFrame } from '../../photo';
import { PanoFramesService } from '../pano-frames.service';
import { PreviewCacheService } from '../preview-cache.service';

function panoFixture(orientation: 'horizontal' | 'vertical' = 'horizontal'): Pano {
  return {
    id: 'pano1',
    name: 'Panorama',
    album: 'Peaks',
    taken: '2026-05-24',
    status: 'backlog',
    kind: 'pano',
    orientation,
    frames: [
      { id: 'pn1', name: 'DSC_1' },
      { id: 'pn2', name: 'DSC_2', blur: true },
    ],
  };
}

// PanoCardComponent has no class logic — its only behaviour is the action buttons emitting `swiped`,
// so this renders the template and clicks the real buttons.
describe('PanoCardComponent', () => {
  let fixture: ComponentFixture<PanoCardComponent>;
  let component: PanoCardComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PanoCardComponent],
      providers: [
        // Only reached once the frame picker opens; stubbed so the card's own tests stay offline.
        {
          provide: PanoFramesService,
          useValue: {
            candidatesFor: () =>
              Promise.resolve([
                { id: 'pn0', name: 'DSC_0', taken: '2026-05-24T10:00:00' },
                { id: 'pn1', name: 'DSC_1', taken: '2026-05-24T10:00:01' },
                { id: 'pn2', name: 'DSC_2', taken: '2026-05-24T10:00:02' },
              ]),
          },
        },
        {
          provide: PreviewCacheService,
          useValue: { url: () => null, ensure: () => Promise.resolve() },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(PanoCardComponent);
    component = fixture.componentInstance;
    component.pano = panoFixture();
    fixture.detectChanges();
  });

  function clickButton(symbol: string): void {
    const root = fixture.nativeElement as HTMLElement;
    const buttons = root.querySelectorAll<HTMLButtonElement>('.action-buttons button');
    const button = Array.from(buttons).find((b) => b.textContent?.trim() === symbol);
    if (!button) {
      throw new Error(`No action button with label "${symbol}"`);
    }
    button.click();
  }

  const cases: [string, string][] = [
    ['✕', 'rejected'],
    ['↑', 'toEdit'],
    ['✓', 'kept'],
    ['↓', 'maybe'],
  ];

  for (const [symbol, expected] of cases) {
    it(`emits "${expected}" when the ${symbol} button is clicked`, () => {
      let emitted: string | undefined;
      component.swiped.subscribe((value) => (emitted = value));

      clickButton(symbol);

      expect(emitted).toBe(expected);
    });
  }

  it('renders a frame image when a preview URL is available, else the frame name', () => {
    fixture.componentRef.setInput('imageUrls', new Map([['pn1', 'blob:fake-pn1']]));
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const frames = root.querySelectorAll<HTMLElement>('.pano-frame');
    expect(frames[0].querySelector('img.pano-frame-img')).not.toBeNull();
    expect(frames[1].querySelector('img.pano-frame-img')).toBeNull(); // no URL → name placeholder
    expect(frames[1].querySelector('.frame-name')?.textContent?.trim()).toBe('DSC_2');
  });

  it('marks the strip vertical only for a vertical pano', () => {
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.pano-strip')?.classList.contains('vertical')).toBe(false);

    fixture.componentRef.setInput('pano', panoFixture('vertical'));
    fixture.detectChanges();
    expect(root.querySelector('.pano-strip')?.classList.contains('vertical')).toBe(true);
  });
});

describe('PanoCardComponent — "photos are missing"', () => {
  let fixture: ComponentFixture<PanoCardComponent>;
  let root: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PanoCardComponent],
      providers: [
        {
          provide: PanoFramesService,
          useValue: {
            candidatesFor: () =>
              Promise.resolve([
                { id: 'pn0', name: 'DSC_0', taken: '2026-05-24T10:00:00' },
                { id: 'pn1', name: 'DSC_1', taken: '2026-05-24T10:00:01' },
                { id: 'pn2', name: 'DSC_2', taken: '2026-05-24T10:00:02' },
              ]),
          },
        },
        {
          provide: PreviewCacheService,
          useValue: { url: () => null, ensure: () => Promise.resolve() },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(PanoCardComponent);
    fixture.componentInstance.pano = panoFixture();
    fixture.detectChanges();
    root = fixture.nativeElement as HTMLElement;
  });

  function clickCorrection(label: string): void {
    const buttons = Array.from(
      root.querySelectorAll<HTMLButtonElement>('.pano-corrections button'),
    );
    buttons.find((b) => b.textContent?.includes(label))?.click();
    fixture.detectChanges();
  }

  it('swaps the sweep for the picker, so the same photos are only asked about once', async () => {
    clickCorrection('photos are missing');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(root.querySelector('app-pano-frame-picker')).not.toBeNull();
    expect(root.querySelector('.pano-strip')).toBeNull();
  });

  it('hands the confirmed frames up and puts the sweep back', async () => {
    let changed: PanoFrame[] | undefined;
    fixture.componentInstance.framesChanged.subscribe((frames) => (changed = frames));
    clickCorrection('photos are missing');
    await fixture.whenStable();
    fixture.detectChanges();

    root.querySelector<HTMLButtonElement>('.picker-frame')?.click(); // add the shot before the sweep
    fixture.detectChanges();
    root.querySelector<HTMLButtonElement>('.picker-done')?.click();
    fixture.detectChanges();

    expect(changed?.map((f) => f.id)).toEqual(['pn0', 'pn1', 'pn2']);
    expect(root.querySelector('.pano-strip')).not.toBeNull(); // back to the sweep
  });

  it('leaves the pano alone on Cancel', async () => {
    let changed: PanoFrame[] | undefined;
    fixture.componentInstance.framesChanged.subscribe((frames) => (changed = frames));
    clickCorrection('photos are missing');
    await fixture.whenStable();
    fixture.detectChanges();

    root.querySelector<HTMLButtonElement>('.picker-cancel')?.click();
    fixture.detectChanges();

    expect(changed).toBeUndefined();
    expect(root.querySelector('.pano-strip')).not.toBeNull();
  });
});
