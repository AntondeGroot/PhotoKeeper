import { StereoCardComponent } from './stereo-card';
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
      { key: '10m', label: '10 m', hint: '', frames: [], recommended: true },
    ],
  };
}

describe('StereoCardComponent', () => {
  let component: StereoCardComponent;

  beforeEach(() => {
    component = new StereoCardComponent();
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
});
