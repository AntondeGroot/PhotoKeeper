import { FullscreenViewerComponent } from './fullscreen-viewer';

describe('FullscreenViewerComponent', () => {
  let component: FullscreenViewerComponent;

  const down = (x: number, y: number) =>
    component.onPointerDown({ clientX: x, clientY: y } as PointerEvent);
  const move = (x: number, y: number) =>
    component.onPointerMove({ clientX: x, clientY: y } as PointerEvent);
  const up = () => component.onPointerUp();

  beforeEach(() => {
    component = new FullscreenViewerComponent();
    component.images = [
      { label: 'A', url: undefined },
      { label: 'B', url: undefined },
    ];
  });

  it('starts on the first image and reports multiple', () => {
    expect(component.index()).toBe(0);
    expect(component.current()?.label).toBe('A');
    expect(component.multi()).toBe(true);
  });

  it('re-renders when a new images array is set (resets to the first)', () => {
    component.show(1);
    expect(component.current()?.label).toBe('B');
    component.images = [{ label: 'next', url: undefined }];
    expect(component.index()).toBe(0);
    expect(component.current()?.label).toBe('next');
  });

  it('opens on startIndex (the tapped frame), order-independent', () => {
    const v = new FullscreenViewerComponent();
    v.startIndex = 1; // set before images
    v.images = [
      { label: 'A', url: undefined },
      { label: 'B', url: undefined },
    ];
    expect(v.index()).toBe(1);
    expect(v.current()?.label).toBe('B');
  });

  it('show() switches to a valid index and ignores out-of-range', () => {
    component.show(1);
    expect(component.current()?.label).toBe('B');
    component.show(5);
    expect(component.index()).toBe(1); // unchanged
  });

  it('swiping left/right steps through and wraps (compare mode)', () => {
    down(200, 100);
    move(100, 100); // left → next
    up();
    expect(component.current()?.label).toBe('B');

    down(100, 100);
    move(200, 100); // right → prev
    up();
    expect(component.current()?.label).toBe('A');

    down(100, 100);
    move(50, 100); // left from A → wraps to B
    up();
    expect(component.current()?.label).toBe('B');
  });

  it('a tap (no real drag) closes', () => {
    let closed = false;
    component.closed.subscribe(() => (closed = true));
    down(100, 100);
    move(104, 103); // < 10px → tap
    up();
    expect(closed).toBe(true);
    expect(component.index()).toBe(0);
  });

  it('chooseVerdict emits the verdict (review buttons)', () => {
    const verdicts: string[] = [];
    component.verdict.subscribe((v) => verdicts.push(v));
    component.chooseVerdict('kept');
    component.chooseVerdict('rejected');
    expect(verdicts).toEqual(['kept', 'rejected']);
  });

  it('swiping in review mode emits a verdict instead of switching frames', () => {
    component.reviewMode = true;
    const verdicts: string[] = [];
    component.verdict.subscribe((v) => verdicts.push(v));

    down(100, 100);
    move(220, 105); // right → kept
    up();
    down(100, 100);
    move(105, 10); // up (dy -90) → toEdit
    up();

    expect(verdicts).toEqual(['kept', 'toEdit']);
    expect(component.index()).toBe(0); // never switches frames in review mode
  });

  it('close emits closed', () => {
    let closed = false;
    component.closed.subscribe(() => (closed = true));
    component.close();
    expect(closed).toBe(true);
  });

  it('is single (not multi) with one image', () => {
    component.images = [{ label: 'A', url: undefined }];
    expect(component.multi()).toBe(false);
  });
});
