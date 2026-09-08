import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PhotoCardComponent } from './photo-card';
import { Photo } from '../../photo';

const photo: Photo = {
  id: 'a',
  name: 'DSC_0001',
  ext: 'NEF',
  album: 'Iceland',
  taken: '2026-05-01',
  status: 'backlog',
  kind: 'photo',
  starred: false,
  saveOnly: false,
};

describe('PhotoCardComponent', () => {
  let fixture: ComponentFixture<PhotoCardComponent>;
  let root: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [PhotoCardComponent] }).compileComponents();
    fixture = TestBed.createComponent(PhotoCardComponent);
    fixture.componentRef.setInput('photo', photo);
    fixture.detectChanges();
    root = fixture.nativeElement as HTMLElement;
  });

  /** Drags the card as a finger would, without committing to a verdict. */
  function dragTo(x: number, y: number): void {
    fixture.componentInstance.dragX.set(x);
    fixture.componentInstance.dragY.set(y);
    fixture.detectChanges();
  }

  /**
   * The labels are the targets you are aiming at while you drag. Moving them with the card lets them
   * be pushed off the edge of the screen, or under the thumb doing the pushing, exactly as you reach
   * for them — which is why the tag card was built the other way round.
   */
  it('moves the picture with the drag and leaves the verdict labels where they are', () => {
    dragTo(80, -20);

    const area = root.querySelector<HTMLElement>('.photo-area');
    const card = root.querySelector<HTMLElement>('.photo-card');

    expect(area?.style.transform).toContain('translate(80px, -20px)');
    expect(card?.style.transform).toBe('');
    for (const overlay of root.querySelectorAll<HTMLElement>('.swipe-overlay')) {
      expect(overlay.style.transform).toBe('');
    }
  });

  /** The visible labels, so a test can say what the person dragging can actually see. */
  function shownLabels(): { label: string; opacity: number }[] {
    return [...root.querySelectorAll<HTMLElement>('.swipe-overlay')]
      .map((el) => ({ label: el.textContent?.trim() ?? '', opacity: Number(el.style.opacity) }))
      .filter((l) => l.opacity > 0);
  }

  /** The labels still have to answer the drag — they fade in, they simply do not travel. */
  it('fades the label for the direction being dragged', () => {
    dragTo(100, 0);

    expect(shownLabels()).toEqual([{ label: 'KEEP →', opacity: 1 }]);
  });

  it('fades the edit label upward and the maybe label downward', () => {
    dragTo(0, -50);
    expect(shownLabels()).toEqual([{ label: '↑ EDIT', opacity: 0.5 }]);

    dragTo(0, 50);
    expect(shownLabels()).toEqual([{ label: '↓ MAYBE', opacity: 0.5 }]);
  });

  /**
   * The complaint this fixes: a diagonal drag lit two labels, so it was not clear which verdict
   * letting go would give — and the answer came from a different rule again, one that checked the
   * horizontal axis first whichever had travelled further.
   */
  it('shows one label on a diagonal, and it is the one that will be given', () => {
    dragTo(60, 140);

    expect(shownLabels()).toEqual([{ label: '↓ MAYBE', opacity: 1 }]);

    let given: string | null = null;
    fixture.componentInstance.swiped.subscribe((v: string) => (given = v));
    fixture.componentInstance.onPointerUp();

    expect(given).toBe('maybe');
  });
});
