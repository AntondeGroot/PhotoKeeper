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
});
