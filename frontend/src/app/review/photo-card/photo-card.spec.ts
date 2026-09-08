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

  /** The labels still have to answer the drag — they fade in, they simply do not travel. */
  it('fades the label for the direction being dragged', () => {
    dragTo(100, 0);

    const keep = root.querySelector<HTMLElement>('.overlay-keep');
    const reject = root.querySelector<HTMLElement>('.overlay-reject');

    expect(Number(keep?.style.opacity)).toBe(1);
    expect(Number(reject?.style.opacity)).toBe(0);
  });

  it('fades the edit label upward and the maybe label downward', () => {
    dragTo(0, -50);
    expect(Number(root.querySelector<HTMLElement>('.overlay-edit')?.style.opacity)).toBeCloseTo(
      0.5,
    );

    dragTo(0, 50);
    expect(Number(root.querySelector<HTMLElement>('.overlay-maybe')?.style.opacity)).toBeCloseTo(
      0.5,
    );
  });
});
