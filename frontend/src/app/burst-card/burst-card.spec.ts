import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';
import { BurstCardComponent } from './burst-card';
import { Burst } from '../photo';

function burst(photos: { id: string; name: string; blur?: boolean }[]): Burst {
  return {
    id: 'burst1',
    name: 'Burst',
    album: 'Field work',
    taken: '2026-05-24',
    status: 'backlog',
    kind: 'burst',
    photos,
  };
}

function burstFixture(): Burst {
  return burst([
    { id: 'b1', name: 'IMG_1' },
    { id: 'b2', name: 'IMG_2', blur: true },
    { id: 'b3', name: 'IMG_3' },
  ]);
}

describe('BurstCardComponent', () => {
  let component: BurstCardComponent;

  beforeEach(() => {
    component = new BurstCardComponent();
    component.burst = burstFixture();
  });

  it('survivors are the non-blurred frames; excluded are the blurred ones', () => {
    expect(component.survivors().map((p) => p.id)).toEqual(['b1', 'b3']);
    expect(component.excluded().map((p) => p.id)).toEqual(['b2']);
  });

  it('duels the survivors a pair at a time and emits the final winner', () => {
    component.burst = burst([
      { id: 's1', name: 'A' },
      { id: 's2', name: 'B' },
      { id: 's3', name: 'C' },
    ]);
    let winner: string | undefined;
    component.picked.subscribe((id) => (winner = id));

    expect(component.duel()).toEqual({
      a: { id: 's1', name: 'A' },
      b: { id: 's2', name: 'B' },
    });

    component.chooseWinner('s2'); // s2 beats s1 → champion, next challenger s3
    expect(winner).toBeUndefined();
    expect(component.duel()).toEqual({ a: { id: 's2', name: 'B' }, b: { id: 's3', name: 'C' } });

    component.chooseWinner('s3'); // s3 beats s2 → no challengers left → resolved
    expect(winner).toBe('s3');
  });

  it('has no duel for a single survivor and keepChampion emits it', () => {
    component.burst = burst([{ id: 's1', name: 'only' }]);
    let winner: string | undefined;
    component.picked.subscribe((id) => (winner = id));

    expect(component.duel()).toBeNull();

    component.keepChampion();
    expect(winner).toBe('s1');
  });

  it('zoomed starts false and toggleZoom flips it back and forth', () => {
    expect(component.zoomed()).toBe(false);
    component.toggleZoom();
    expect(component.zoomed()).toBe(true);
    component.toggleZoom();
    expect(component.zoomed()).toBe(false);
  });

  it('renders an image for a duel frame that has a preview URL', () => {
    const fixture = TestBed.createComponent(BurstCardComponent);
    const sanitizer = TestBed.inject(DomSanitizer);
    fixture.componentInstance.burst = burstFixture(); // duel is b1 (A) vs b3 (B)
    fixture.componentInstance.imageUrls = new Map([
      ['b1', sanitizer.bypassSecurityTrustUrl('data:image/png;base64,AAAA')],
    ]);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('img.burst-frame-img').length).toBe(1); // only b1 has a URL
  });

  it('emits dissolved when "not a burst" is clicked', () => {
    const fixture = TestBed.createComponent(BurstCardComponent);
    fixture.componentInstance.burst = burstFixture();
    let emitted = false;
    fixture.componentInstance.dissolved.subscribe(() => (emitted = true));
    fixture.detectChanges();

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.not-a-burst')
      ?.click();

    expect(emitted).toBe(true);
  });
});
