import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TagReviewComponent } from './tag-review';
import { Photo } from '../../photo';
import { Tag } from '../tags';
import { TagDirections } from '../tags';

const photo: Photo = {
  id: 'IMG_1',
  name: 'IMG_1',
  ext: 'CR2',
  album: 'Trip',
  taken: '2026-05-01',
  status: 'kept',
  kind: 'photo',
  starred: false,
  keepsake: false,
};

const tags: Tag[] = [
  { id: 'animals', name: 'Animals' },
  { id: 'family', name: 'Family' },
  { id: 'friends', name: 'Friends' },
];

// Animals→left, Family→right; Friends is unbound (appears as a chip below).
const directions: TagDirections = { left: 'animals', right: 'family' };

/** The same, with Friends on a corner — the diagonals are bindable like any other direction. */
const withCorner: TagDirections = { ...directions, 'up-left': 'friends' };

describe('TagReviewComponent', () => {
  let fixture: ComponentFixture<TagReviewComponent>;
  let component: TagReviewComponent;
  let root: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TagReviewComponent] }).compileComponents();
    fixture = TestBed.createComponent(TagReviewComponent);
    component = fixture.componentInstance;
  });

  function render(inputs: Partial<TagReviewComponent>): void {
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    root = fixture.nativeElement as HTMLElement;
  }

  const down = (x: number, y: number) =>
    component.onPointerDown({ clientX: x, clientY: y } as PointerEvent);
  const move = (x: number, y: number) =>
    component.onPointerMove({ clientX: x, clientY: y } as PointerEvent);

  it('shows the empty state when there is no photo', () => {
    render({ photo: undefined, tags });
    expect(root.querySelector('.tag-empty')).not.toBeNull();
    expect(root.querySelector('.tag-card')).toBeNull();
  });

  it('renders an edge label for each bound direction, plus the reserved corner', () => {
    render({ photo, tags, directions });
    const edges = Array.from(root.querySelectorAll('.edge')).map((e) => e.textContent?.trim());
    // "No tag" is always offered: it is what settles a photo none of the tags fit.
    expect(edges).toEqual(['← Animals', '→ Family', '↘ No tag']);
    // Only the unbound 'Friends' shows as a below chip.
    const chips = Array.from(root.querySelectorAll('.other-chip')).map((c) =>
      c.textContent?.trim(),
    );
    expect(chips).toEqual(['Friends']);
    expect(root.querySelector('.tag-card-name')?.textContent?.trim()).toBe('IMG_1.CR2');
  });

  it('moves the picture with the drag and leaves the labels where they are', () => {
    // The labels are the target: one that travels with the photo leaves the screen just as you
    // reach for it, which is exactly how a corner becomes unhittable.
    render({ photo, tags, directions });
    down(200, 200);
    move(120, 150); // 80 left, 50 up
    fixture.detectChanges();

    const photoLayer = root.querySelector<HTMLElement>('.tag-card-photo');
    expect(photoLayer?.style.transform).toBe('translate(-80px, -50px)');
    for (const edge of Array.from(root.querySelectorAll<HTMLElement>('.edge'))) {
      expect(edge.style.transform).not.toContain('-80px');
    }
    expect(root.querySelector<HTMLElement>('.tag-card')?.style.transform).toBe('');
  });

  it('lights the corner a diagonal drag points at, and only that one', () => {
    render({ photo, tags, directions: withCorner });
    down(200, 200);
    move(120, 120); // dx=-80, dy=-80 — squarely up-left
    fixture.detectChanges();

    const active = Array.from(root.querySelectorAll('.edge.active')).map((e) =>
      e.textContent?.trim(),
    );
    expect(active).toEqual(['↖ Friends']); // not Animals (left) as well
  });

  it('commits a corner swipe to the tag on that corner', () => {
    render({ photo, tags, directions: withCorner });
    let dir: string | undefined;
    component.swiped.subscribe((d) => (dir = d));

    down(200, 200);
    move(120, 120);
    component.onPointerUp();

    expect(dir).toBe('up-left');
  });

  it('applies no tag from the reserved corner, whatever the tag bindings are', () => {
    render({ photo, tags, directions });
    let dir: string | undefined;
    component.swiped.subscribe((d) => (dir = d));

    down(100, 100);
    move(190, 190); // down-right
    component.onPointerUp();

    expect(dir).toBe('down-right');
  });

  it('keeps the photo and applies nothing when a drag is taken back to the middle', () => {
    // Committing is something you do, not something you fail to undo: coming back to the middle is
    // how you change your mind mid-swipe.
    render({ photo, tags, directions });
    let emitted = false;
    component.swiped.subscribe(() => (emitted = true));

    down(200, 200);
    move(90, 200); // 110px left — Animals is lit
    fixture.detectChanges();
    expect(root.querySelectorAll('.edge.active')).toHaveLength(1);

    move(205, 202); // back to the middle
    fixture.detectChanges();
    expect(root.querySelectorAll('.edge.active')).toHaveLength(0);

    component.onPointerUp();

    expect(emitted).toBe(false);
    expect(root.querySelector('.tag-card')).not.toBeNull(); // still on the same photo
  });

  it('emits the direction on a clear swipe over a bound edge', () => {
    render({ photo, tags, directions });
    let dir: string | undefined;
    component.swiped.subscribe((d) => (dir = d));

    down(200, 100);
    move(90, 100); // 110px left → bound (Animals)
    component.onPointerUp();

    expect(dir).toBe('left');
  });

  it('ignores a swipe toward an unbound direction', () => {
    render({ photo, tags, directions }); // up/down unbound
    let emitted = false;
    component.swiped.subscribe(() => (emitted = true));

    down(100, 200);
    move(100, 90); // 110px up → unbound
    component.onPointerUp();

    expect(emitted).toBe(false);
  });

  it('ignores a tap (too-small drag)', () => {
    render({ photo, tags, directions });
    let emitted = false;
    component.swiped.subscribe(() => (emitted = true));

    down(100, 100);
    move(120, 100); // 20px → below threshold
    component.onPointerUp();

    expect(emitted).toBe(false);
  });

  it('toggles an unbound tag via its below chip', () => {
    render({ photo, tags, directions, appliedTagIds: ['friends'] });
    const chip = root.querySelector<HTMLButtonElement>('.other-chip');
    expect(chip?.classList.contains('on')).toBe(true);

    let toggled: string | undefined;
    component.tagToggled.subscribe((id) => (toggled = id));
    chip?.click();
    expect(toggled).toBe('friends');
  });

  it('shows the built-in "no tag" as a removable chip once it has been applied', () => {
    // It is a real assignment, so it has to be as takeable-back as any other.
    render({ photo, tags, directions, appliedTagIds: ['no-tag'] });

    const applied = root.querySelector<HTMLButtonElement>('.applied-chip');
    expect(applied?.textContent?.trim()).toBe('No tag ✕');
  });

  it('shows applied tags as removable chips that emit on click', () => {
    render({ photo, tags, directions, appliedTagIds: ['animals'] });
    const applied = root.querySelector<HTMLButtonElement>('.applied-chip');
    expect(applied?.textContent?.trim()).toBe('Animals ✕');

    let toggled: string | undefined;
    component.tagToggled.subscribe((id) => (toggled = id));
    applied?.click();
    expect(toggled).toBe('animals');
  });
});
