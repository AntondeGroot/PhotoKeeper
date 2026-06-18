import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';
import { BurstCardComponent } from './burst-card';
import { Burst } from '../photo';

function burstFixture(): Burst {
  return {
    id: 'burst1',
    name: 'Burst',
    album: 'Field work',
    taken: '2026-05-24',
    status: 'backlog',
    kind: 'burst',
    photos: [
      { id: 'b1', name: 'IMG_1' },
      { id: 'b2', name: 'IMG_2', blur: true },
      { id: 'b3', name: 'IMG_3' },
    ],
  };
}

describe('BurstCardComponent', () => {
  let component: BurstCardComponent;

  beforeEach(() => {
    component = new BurstCardComponent();
    component.burst = burstFixture();
  });

  it('survivors returns only the non-blurred frames', () => {
    expect(component.survivors.map((p) => p.id)).toEqual(['b1', 'b3']);
  });

  it('excluded returns only the blurred frames', () => {
    expect(component.excluded.map((p) => p.id)).toEqual(['b2']);
  });

  it('zoomed starts false and toggleZoom flips it back and forth', () => {
    expect(component.zoomed()).toBe(false);

    component.toggleZoom();
    expect(component.zoomed()).toBe(true);

    component.toggleZoom();
    expect(component.zoomed()).toBe(false);
  });

  it('renders a frame image only for survivors that have a preview URL', () => {
    const fixture = TestBed.createComponent(BurstCardComponent);
    const sanitizer = TestBed.inject(DomSanitizer);
    fixture.componentInstance.burst = burstFixture();
    // survivors are b1 and b3; only b1 has a warmed preview.
    fixture.componentInstance.imageUrls = new Map([
      ['b1', sanitizer.bypassSecurityTrustUrl('data:image/png;base64,AAAA')],
    ]);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('img.burst-frame-img').length).toBe(1);
  });
});
