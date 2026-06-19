import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SceneComponent } from './scene';
import { PhotoScene } from '../photo';

const base: PhotoScene = {
  variant: 'peaks',
  sky: '#102030',
  far: '#203040',
  near: '#304050',
  sun: '#f0d090',
  sunX: 120,
  sunY: 80,
};

describe('SceneComponent', () => {
  let fixture: ComponentFixture<SceneComponent>;
  let svg: SVGElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SceneComponent] }).compileComponents();
    fixture = TestBed.createComponent(SceneComponent);
  });

  function render(scene: PhotoScene): void {
    fixture.componentRef.setInput('scene', scene);
    fixture.detectChanges();
    svg = (fixture.nativeElement as HTMLElement).querySelector('svg')!;
  }

  it('always paints the sky and a sun tinted by the scene colours', () => {
    render(base);
    expect(svg.querySelector('rect')?.getAttribute('fill')).toBe('#102030');
    expect(svg.querySelector('circle')?.getAttribute('fill')).toBe('#f0d090');
  });

  it('draws six trees for the forest variant', () => {
    render({ ...base, variant: 'forest' });
    // 6 triangle tops, each tinted with the far colour
    const triangles = svg.querySelectorAll('polygon');
    expect(triangles).toHaveLength(6);
    expect(triangles[0].getAttribute('fill')).toBe('#203040');
  });

  it('draws six buildings each with three lit windows for the city variant', () => {
    render({ ...base, variant: 'city' });
    // 6 buildings + 18 windows = 24 rects (no sky rect counted: it is the first <rect>, so 1 + 24)
    const windows = Array.from(svg.querySelectorAll('rect')).filter(
      (r) => r.getAttribute('opacity') === '0.35',
    );
    expect(windows).toHaveLength(18);
  });

  it('adds birds only when asked', () => {
    render({ ...base, variant: 'coast' });
    expect(svg.querySelector('g')).toBeNull();

    render({ ...base, variant: 'coast', birds: true });
    expect(svg.querySelector('g')).not.toBeNull();
  });

  it('blurs the scene when the photo is soft', () => {
    render({ ...base, blur: true });
    expect(svg.classList.contains('blur')).toBe(true);
  });
});
