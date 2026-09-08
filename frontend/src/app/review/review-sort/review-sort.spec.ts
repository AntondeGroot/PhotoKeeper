import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ReviewSortComponent } from './review-sort';
import { NavigationService } from '../../navigation.service';
import { PanoFramesService } from '../pano-frames.service';
import { PreviewCacheService } from '../preview-cache.service';
import { PanoCandidate } from '../pano-frames';
import { Photo } from '../../photo';

const photo = (id: string): Photo => ({
  id,
  name: id,
  ext: 'NEF',
  album: 'Lisbon',
  taken: '2026-05-01',
  status: 'backlog',
  kind: 'photo',
  starred: false,
  saveOnly: false,
});

const CANDIDATES: PanoCandidate[] = [
  { id: 'a1', name: 'IMG_1', taken: '2026-05-01T10:00:00Z' },
  { id: 'a2', name: 'IMG_2', taken: '2026-05-01T10:00:02Z' },
  { id: 'a3', name: 'IMG_3', taken: '2026-05-01T10:00:04Z' },
];

describe('ReviewSortComponent', () => {
  let fixture: ComponentFixture<ReviewSortComponent>;
  let root: HTMLElement;
  let loads: number;

  beforeEach(async () => {
    loads = 0;
    await TestBed.configureTestingModule({
      imports: [ReviewSortComponent],
      providers: [
        {
          provide: NavigationService,
          useValue: { panoPicking: signal(true), closePanoPicker: () => undefined },
        },
        {
          provide: PanoFramesService,
          useValue: {
            candidatesFor: () => {
              loads++;
              return Promise.resolve(CANDIDATES);
            },
          },
        },
        {
          provide: PreviewCacheService,
          useValue: { url: () => null, ensure: () => Promise.resolve() },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ReviewSortComponent);
    fixture.componentRef.setInput('photo', photo('a2'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    root = fixture.nativeElement as HTMLElement;
  });

  /** The ringed frames — what the picker says the panorama consists of. */
  function ringed(): string[] {
    return [...root.querySelectorAll<HTMLElement>('.picker-frame.chosen')].map(
      (el) => el.textContent?.trim() ?? '',
    );
  }

  /**
   * The bug this pins. The seed was a method, so every change-detection pass handed the picker a
   * *new array*; its effect re-ran, reloaded the neighbourhood and reset the rings — the strip
   * flickered through "Looking for the photos around it…" and a tap was undone before it landed.
   */
  it('keeps a tapped frame ringed through the next change detection', () => {
    const frames = root.querySelectorAll<HTMLButtonElement>('.picker-frame');
    frames[0].click();
    fixture.detectChanges();

    expect(ringed()).toEqual(['IMG_1', 'IMG_2']); // the tapped one, and the photo it started from
  });

  /** The flicker half of the same fault: re-running the effect re-read the album and blanked the
   *  strip to "Looking for the photos around it…" between every tap. */
  it('does not re-read the neighbourhood when a frame is tapped', () => {
    root.querySelectorAll<HTMLButtonElement>('.picker-frame')[0].click();
    fixture.detectChanges();

    expect(loads).toBe(1);
  });
});
