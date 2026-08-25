import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PanoFramePickerComponent } from './frame-picker';
import { PanoFramesService } from '../../pano-frames.service';
import { PreviewCacheService } from '../../preview-cache.service';
import { PanoCandidate } from '../../pano-frames';
import { Pano, PanoFrame } from '../../../photo';

/** The album around the pano: two shots before it, its own two frames, one after. */
const CANDIDATES: PanoCandidate[] = [
  { id: 'a1', name: 'DSC_1', ext: 'NEF', taken: '2026-05-24T10:00:01' },
  { id: 'a2', name: 'DSC_2', ext: 'NEF', taken: '2026-05-24T10:00:02' },
  { id: 'pn1', name: 'DSC_3', ext: 'NEF', taken: '2026-05-24T10:00:03' },
  { id: 'pn2', name: 'DSC_4', ext: 'NEF', taken: '2026-05-24T10:00:04' },
  { id: 'a5', name: 'DSC_5', ext: 'NEF', taken: '2026-05-24T10:00:05' },
];

function pano(): Pano {
  return {
    id: 'pano1',
    name: 'Panorama · 2 frames',
    album: 'Peaks',
    taken: '2026-05-24',
    status: 'backlog',
    kind: 'pano',
    orientation: 'horizontal',
    frames: [
      { id: 'pn1', name: 'DSC_3', ext: 'NEF' },
      { id: 'pn2', name: 'DSC_4', ext: 'NEF' },
    ],
  };
}

describe('PanoFramePickerComponent', () => {
  let fixture: ComponentFixture<PanoFramePickerComponent>;
  let root: HTMLElement;
  let warmed: string[];

  beforeEach(async () => {
    warmed = [];
    await TestBed.configureTestingModule({
      imports: [PanoFramePickerComponent],
      providers: [
        {
          provide: PanoFramesService,
          useValue: { candidatesFor: () => Promise.resolve(CANDIDATES) },
        },
        {
          provide: PreviewCacheService,
          useValue: {
            url: () => null,
            ensure: (id: string) => {
              warmed.push(id);
              return Promise.resolve();
            },
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(PanoFramePickerComponent);
    fixture.componentRef.setInput('pano', pano());
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    root = fixture.nativeElement as HTMLElement;
  });

  function frames(): HTMLButtonElement[] {
    return Array.from(root.querySelectorAll<HTMLButtonElement>('.picker-frame'));
  }

  function ringed(): string[] {
    return frames()
      .filter((frame) => frame.classList.contains('chosen'))
      .map((frame) => frame.textContent?.trim() ?? '');
  }

  it('offers the shots either side of the pano, ringing the ones it already has', () => {
    expect(frames()).toHaveLength(5);
    expect(ringed()).toEqual(['DSC_3.NEF', 'DSC_4.NEF']);
  });

  it('warms the neighbours previews — nothing else fetches them', () => {
    // They are not part of the review deck, and a strip of file names is not something anyone can
    // pick a panorama frame out of.
    expect(warmed).toEqual(['a1', 'a2', 'pn1', 'pn2', 'a5']);
  });

  it('rings a neighbouring shot when it is tapped', () => {
    frames()[1].click(); // DSC_2, just before the sweep
    fixture.detectChanges();

    expect(ringed()).toEqual(['DSC_2.NEF', 'DSC_3.NEF', 'DSC_4.NEF']);
  });

  it('takes the ring off a frame tapped again', () => {
    frames()[1].click();
    fixture.detectChanges();
    frames()[1].click();
    fixture.detectChanges();

    expect(ringed()).toEqual(['DSC_3.NEF', 'DSC_4.NEF']);
  });

  it('hands back the whole sweep in capture order on Done', () => {
    let confirmed: PanoFrame[] | undefined;
    fixture.componentInstance.confirmed.subscribe((f) => (confirmed = f));

    frames()[4].click(); // DSC_5, just after the sweep
    fixture.detectChanges();
    root.querySelector<HTMLButtonElement>('.picker-done')?.click();

    expect(confirmed).toEqual([
      { id: 'pn1', name: 'DSC_3', ext: 'NEF' },
      { id: 'pn2', name: 'DSC_4', ext: 'NEF' },
      { id: 'a5', name: 'DSC_5', ext: 'NEF' },
    ]);
  });

  it('keeps Done inert until something has actually changed', () => {
    const done = root.querySelector<HTMLButtonElement>('.picker-done');
    expect(done?.disabled).toBe(true);

    frames()[0].click();
    fixture.detectChanges();

    expect(done?.disabled).toBe(false);
  });
});
