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

  /**
   * Drags the card as a finger would: pressed first, then moved. The press matters — a release the
   * card never saw the start of is deliberately ignored, so that a child taking its own tap does
   * not also open the photo.
   */
  function dragTo(x: number, y: number): void {
    fixture.componentInstance.dragging.set(true);
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

  /**
   * What went wrong when the "part of a panorama" button sat on the photo: children that take their
   * own taps stop `pointerdown`, but `pointerup` still reaches the card — and with no movement
   * behind it, the card read it as a tap and opened the picture on top of whatever was happening.
   */
  /**
   * The bug this covers: the two halves of an edited pair took `pointerdown` for themselves so a tap
   * could enlarge one — but they are the whole of the card, so a swipe had nowhere left to begin and
   * the pair could not be judged at all. It is one photograph in two files, and the verdict is one
   * verdict, so the gesture belongs to the card.
   */
  describe('an edited pair', () => {
    const edited = {
      ...photo,
      edit: { originalId: 'orig', originalName: 'DSC_1878', originalExt: 'NEF' },
    };

    beforeEach(() => {
      fixture.componentRef.setInput('photo', edited);
      fixture.detectChanges();
    });

    it('lets the swipe start on either half', () => {
      const card = root.querySelector<HTMLElement>('.photo-card') as HTMLElement;
      // The test DOM has no pointer capture at all; the card only asks for it to keep the drag.
      Object.defineProperty(card, 'setPointerCapture', {
        value: () => undefined,
        configurable: true,
      });
      const halves = root.querySelectorAll<HTMLElement>('.ba-frame');
      expect(halves).toHaveLength(2);

      for (const half of halves) {
        fixture.componentInstance.dragging.set(false);

        // Pressed on the picture, as a finger does. Nothing may swallow it: the card is the only
        // thing that can move the pair, and the pair is the whole of the card.
        half.dispatchEvent(
          new PointerEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }),
        );

        expect(fixture.componentInstance.dragging()).toBe(true);
      }
    });

    it('gives the verdict when the pair is swiped', () => {
      let given: string | null = null;
      fixture.componentInstance.swiped.subscribe((v: string) => (given = v));

      dragTo(200, 0);
      fixture.componentInstance.onPointerUp();

      expect(given).toBe('kept');
    });

    /** A tap still enlarges the half under the finger, which is what the halves were for. */
    it('enlarges the half a tap lands on', () => {
      const compared: { ids: string[]; start: number }[] = [];
      fixture.componentInstance.compare.subscribe((c: { ids: string[]; start: number }) =>
        compared.push(c),
      );
      const card = root.querySelector<HTMLElement>('.photo-card');
      vi.spyOn(card as HTMLElement, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        width: 200,
      } as DOMRect);

      dragTo(0, 0);
      fixture.componentInstance.onPointerUp({
        clientX: 150,
        currentTarget: card,
      } as unknown as PointerEvent);

      expect(compared).toEqual([{ ids: ['orig', 'a'], start: 1 }]); // right half → "after"
    });

    /** And the click the browser fires after that tap must not open it a second time. */
    it('does not open again on the click behind the tap', () => {
      const compared: unknown[] = [];
      fixture.componentInstance.compare.subscribe((c: unknown) => compared.push(c));
      const card = root.querySelector<HTMLElement>('.photo-card');
      vi.spyOn(card as HTMLElement, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        width: 200,
      } as DOMRect);

      dragTo(0, 0);
      fixture.componentInstance.onPointerUp({
        clientX: 10,
        currentTarget: card,
      } as unknown as PointerEvent);
      fixture.componentInstance.openFrame(0); // the click that follows

      expect(compared).toHaveLength(1);
    });

    /** A keyboard press reaches the same button with no gesture behind it, and must still work. */
    it('opens a half for the keyboard', () => {
      const compared: { start: number }[] = [];
      fixture.componentInstance.compare.subscribe((c: { start: number }) => compared.push(c));

      fixture.componentInstance.openFrame(1);

      expect(compared).toEqual([{ ids: ['orig', 'a'], start: 1 }]);
    });
  });

  it('ignores a release it never saw the start of', () => {
    let opened = false;
    fixture.componentInstance.tapped.subscribe(() => (opened = true));

    fixture.componentInstance.onPointerUp(); // no press: a child handled that

    expect(opened).toBe(false);
  });

  it('still opens the photo on a real tap', () => {
    let opened = false;
    fixture.componentInstance.tapped.subscribe(() => (opened = true));

    dragTo(0, 0); // pressed, not moved
    fixture.componentInstance.onPointerUp();

    expect(opened).toBe(true);
  });
});
