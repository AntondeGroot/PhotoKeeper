import { TestBed } from '@angular/core/testing';
import { StereoCardComponent } from './stereo-card';
import { PreviewCacheService } from '../preview-cache.service';
import { Stereo } from '../../photo';

function stereoFixture(): Stereo {
  return {
    id: 'stereo1',
    name: 'Stereo set',
    album: 'Field work',
    taken: '2026-05-24',
    status: 'backlog',
    kind: 'stereo',
    left: [],
    baselines: [
      { key: '3m', label: '3 m', hint: '', frames: [] },
      { key: '10m', label: '10 m', hint: '', frames: [] },
    ],
  };
}

describe('StereoCardComponent', () => {
  let component: StereoCardComponent;

  beforeEach(() => {
    // Stub the preview cache (the card injects it for frame thumbnails) so we can new it up directly.
    TestBed.configureTestingModule({
      providers: [{ provide: PreviewCacheService, useValue: { url: () => null } }],
    });
    component = TestBed.runInInjectionContext(() => new StereoCardComponent());
    component.stereo = stereoFixture();
  });

  it('starts with no verdicts and allChosen false', () => {
    expect(component.verdicts()).toEqual({});
    expect(component.allChosen()).toBe(false);
  });

  it('setVerdict records a per-baseline verdict', () => {
    component.setVerdict('3m', 'keep');

    expect(component.verdicts()).toEqual({ '3m': 'keep' });
    expect(component.allChosen()).toBe(false);
  });

  it('allChosen becomes true once every baseline has a verdict', () => {
    component.setVerdict('3m', 'reject');
    component.setVerdict('10m', 'keep');

    expect(component.allChosen()).toBe(true);
  });

  it('confirm emits "rejected" when every baseline is rejected', () => {
    component.setVerdict('3m', 'reject');
    component.setVerdict('10m', 'reject');
    let emitted: string | undefined;
    component.swiped.subscribe((value) => (emitted = value));

    component.confirm();

    expect(emitted).toBe('rejected');
  });

  it('confirm emits "kept" when a baseline is kept and none need editing', () => {
    component.setVerdict('3m', 'keep');
    component.setVerdict('10m', 'reject');
    let emitted: string | undefined;
    component.swiped.subscribe((value) => (emitted = value));

    component.confirm();

    expect(emitted).toBe('kept');
  });

  it('confirm emits "toEdit" when any baseline needs editing', () => {
    component.setVerdict('3m', 'edit');
    component.setVerdict('10m', 'keep');
    let emitted: string | undefined;
    component.swiped.subscribe((value) => (emitted = value));

    component.confirm();

    expect(emitted).toBe('toEdit');
  });

  it('confirm emits "toEdit" when 2D is selected, overriding keep verdicts', () => {
    component.setVerdict('3m', 'keep');
    component.setVerdict('10m', 'keep');
    component.twoD.set(true);
    let emitted: string | undefined;
    component.swiped.subscribe((value) => (emitted = value));

    component.confirm();

    expect(emitted).toBe('toEdit');
  });

  it('summarises a single pair as "stereo pair", not "1 shared left frames · 1 baselines"', () => {
    component.stereo = {
      ...stereoFixture(),
      left: [{ id: 'l1', name: 'L' }],
      baselines: [{ key: 'b0', label: 'pair', hint: '1 frame', frames: [{ id: 'r1', name: 'R' }] }],
    };

    expect(component.meta).toBe('stereo pair');
  });

  it('summarises a multi-baseline set with a shared left, pluralised correctly', () => {
    component.stereo = {
      ...stereoFixture(),
      left: [{ id: 'l1', name: 'L' }],
      baselines: [
        { key: 'b0', label: '3 m', hint: '', frames: [] },
        { key: 'b1', label: '10 m', hint: '', frames: [] },
      ],
    };

    expect(component.meta).toBe('1 shared left frame · 2 baselines');
  });

  it('offers no swap for a non-rig (drone) set', () => {
    expect(component.canSwap).toBe(false);
    expect(component.displayStereo).toBe(component.stereo); // unchanged
  });

  describe('twin-rig swap', () => {
    function rigFixture(): Stereo {
      return {
        id: 'stereo2',
        name: 'Stereo set',
        album: 'Houten',
        taken: '2026-05-24',
        status: 'backlog',
        kind: 'stereo',
        left: [{ id: 'r1', name: 'L' }],
        baselines: [
          { key: 'b0', label: 'pair', hint: '1 frame', frames: [{ id: 'r2', name: 'R' }] },
        ],
        rig: { leftSerial: '4807734', rightSerial: '4887374' },
      };
    }

    beforeEach(() => (component.stereo = rigFixture()));

    it('offers the swap and exchanges the eyes, emitting the new left serial', () => {
      expect(component.canSwap).toBe(true);

      let emitted: { albumName: string | null; leftSerial: string } | undefined;
      component.swapEyes.subscribe((e) => (emitted = e));

      component.toggleSwap();

      expect(component.displayStereo.left.map((f) => f.id)).toEqual(['r2']);
      expect(component.displayStereo.baselines[0].frames.map((f) => f.id)).toEqual(['r1']);
      expect(emitted).toEqual({ albumName: 'Houten', leftSerial: '4887374' });
    });

    it('toggles back to the original eyes and serial on a second swap', () => {
      const emitted: { leftSerial: string }[] = [];
      component.swapEyes.subscribe((e) => emitted.push(e));

      component.toggleSwap();
      component.toggleSwap();

      expect(component.displayStereo.left.map((f) => f.id)).toEqual(['r1']);
      expect(emitted.map((e) => e.leftSerial)).toEqual(['4887374', '4807734']);
    });
  });
});
