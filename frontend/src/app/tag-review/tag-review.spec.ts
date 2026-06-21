import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TagReviewComponent } from './tag-review';
import { Photo } from '../photo';
import { Tag } from '../storage/photokeeper-db';
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

  it('renders an edge label for each bound direction and a chip for unbound tags', () => {
    render({ photo, tags, directions });
    const edges = Array.from(root.querySelectorAll('.edge')).map((e) => e.textContent?.trim());
    expect(edges).toEqual(['← Animals', '→ Family']);
    // Only the unbound 'Friends' shows as a below chip.
    const chips = Array.from(root.querySelectorAll('.other-chip')).map((c) =>
      c.textContent?.trim(),
    );
    expect(chips).toEqual(['Friends']);
    expect(root.querySelector('.tag-card-name')?.textContent?.trim()).toBe('IMG_1.CR2');
  });

  it('highlights only the dominant edge on a diagonal drag (not both axes)', () => {
    render({ photo, tags, directions });
    down(200, 200);
    move(120, 150); // dx=-80 (left, dominant), dy=-50 (up) — both past 0, but left wins
    fixture.detectChanges();

    const active = Array.from(root.querySelectorAll('.edge.active')).map((e) =>
      e.textContent?.trim(),
    );
    expect(active).toEqual(['← Animals']); // only the dominant edge, not Friends (up) too
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
