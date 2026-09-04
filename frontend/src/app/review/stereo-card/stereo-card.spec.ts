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

  // How the per-baseline verdicts collapse into the one verdict the deck records for the unit:
  // editing anywhere wins, then keeping anywhere, and only an all-reject rejects the pair.
  it.each([
    { close: 'reject', far: 'reject', emits: 'rejected', when: 'every baseline is rejected' },
    {
      close: 'keep',
      far: 'reject',
      emits: 'kept',
      when: 'a baseline is kept and none need editing',
    },
    { close: 'edit', far: 'keep', emits: 'toEdit', when: 'any baseline needs editing' },
  ] as const)('confirm emits "$emits" when $when', ({ close, far, emits }) => {
    component.setVerdict('3m', close);
    component.setVerdict('10m', far);
    let emitted: string | undefined;
    component.swiped.subscribe((value) => (emitted = value));

    component.confirm();

    expect(emitted).toBe(emits);
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

  describe('moving on to the next set', () => {
    // The bug: the card outlives the unit it shows, and baseline keys repeat across sets, so a
    // verdict left behind reappeared as a choice already made on a pair nobody had looked at — with
    // "Done with this set" enabled to match.
    it('starts the next set clean', () => {
      component.setVerdict('3m', 'keep');
      component.twoD.set(true);

      component.stereo = { ...stereoFixture(), id: 'stereo2' };
      component.ngOnChanges();

      expect(component.verdicts()).toEqual({});
      expect(component.twoD()).toBe(false);
      expect(component.allChosen()).toBe(false);
    });

    // The same set is handed back whenever a per-album L/R swap is persisted. Those verdicts were
    // given to *this* photograph and are still the user's.
    it('keeps the verdicts when the same set is re-handed after a swap', () => {
      component.ngOnChanges(); // the card has now seen this set
      component.setVerdict('3m', 'keep');

      component.stereo = { ...stereoFixture() }; // same id, freshly hydrated
      component.ngOnChanges();

      expect(component.verdicts()).toEqual({ '3m': 'keep' });
    });
  });

  describe('an incomplete pair', () => {
    const album = (name: string) => ({ name, id: `al-${name.replace(/\s/g, '')}` });

    /** The unit built for a half: the eye that exists, and the gap that names the one that does not. */
    function incomplete(gap: Stereo['gap']): Stereo {
      return {
        ...stereoFixture(),
        name: 'Stereo pair · right eye missing',
        left: [{ id: 'L3', name: 'DSC_6003', ext: 'NEF' }],
        baselines: [{ key: 'b0', label: 'incomplete pair', hint: '1 frame', frames: [] }],
        gap,
      };
    }

    it('names the album the missing eye was looked for in', () => {
      component.stereo = incomplete({
        missing: 'right',
        foundIn: album('Iceland L'),
        expectedIn: album('Iceland R'),
      });

      expect(component.gapMessage).toBe(
        'The right eye is missing — nothing in “Iceland R” matches this frame.',
      );
      expect(component.meta).toBe('one eye missing');
    });

    // The other reason a half turns up: the albums were never linked, so there was nowhere to look.
    // The message has to say *that*, not blame a search that never happened.
    it('says the albums are unpaired when no other album was named', () => {
      component.stereo = incomplete({
        missing: 'right',
        foundIn: album('Iceland L'),
        expectedIn: null,
      });

      expect(component.gapMessage).toBe(
        'The right eye is missing — this album is marked as left eyes, but no right-eye album is paired with it.',
      );
    });

    // One album holding both eyes: nothing anywhere recorded which side a lone frame is, so the card
    // must not pick one — it says what is known, and labels the empty slot '?'.
    it('does not claim a side when both eyes came out of one album', () => {
      component.stereo = incomplete({
        missing: 'unknown',
        foundIn: album('Field work'),
        expectedIn: album('Field work'),
      });

      expect(component.gapMessage).toBe(
        'This frame has no other eye — nothing else in “Field work” pairs with it.',
      );
      expect(component.missingLabel).toBe('?');
    });

    it('labels the empty slot with the eye that is missing when the side is known', () => {
      component.stereo = incomplete({
        missing: 'left',
        foundIn: album('Iceland R'),
        expectedIn: album('Iceland L'),
      });

      expect(component.missingLabel).toBe('L');
    });

    describe('the "go and look in Lightroom" links', () => {
      beforeEach(() => {
        component.catalogId = 'cat-1';
      });

      it('offers both albums for a split shoot: the frame’s own, and the one searched', () => {
        component.stereo = incomplete({
          missing: 'right',
          foundIn: album('Iceland L'),
          expectedIn: album('Iceland R'),
        });

        expect(component.gapAlbums).toEqual([
          {
            name: 'Iceland L',
            role: 'this frame',
            url: 'https://lightroom.adobe.com/libraries/cat-1/albums/al-IcelandL/assets',
          },
          {
            name: 'Iceland R',
            role: 'the missing eye',
            url: 'https://lightroom.adobe.com/libraries/cat-1/albums/al-IcelandR/assets',
          },
        ]);
      });

      // A both-eyes album searched itself. Two buttons to the same place would be two ways of
      // saying the same thing, and neither would tell you which to press.
      it('offers one album when the frame was searched for in its own', () => {
        component.stereo = incomplete({
          missing: 'unknown',
          foundIn: album('Field work'),
          expectedIn: album('Field work'),
        });

        expect(component.gapAlbums.map((link) => link.name)).toEqual(['Field work']);
        expect(component.gapAlbums[0].role).toBe('this album');
      });

      it('offers nothing while there is no catalog id to link into', () => {
        component.catalogId = null;
        component.stereo = incomplete({
          missing: 'right',
          foundIn: album('Iceland L'),
          expectedIn: album('Iceland R'),
        });

        expect(component.gapAlbums).toEqual([]);
      });

      it('offers nothing on a whole pair, which has nothing to check', () => {
        expect(component.gapAlbums).toEqual([]);
      });

      // A unit queued before gaps carried album ids: there is no album to link to, and the card must
      // degrade to saying less rather than to throwing inside a template or printing "undefined".
      // The upgrade drops these (PhotoKeeperDb v24); this is what happens until it has run.
      it('survives a stored unit whose gap predates album ids', () => {
        const legacy = { missing: 'right', expectedIn: 'Iceland R' } as unknown as Stereo['gap'];
        component.stereo = { ...incomplete(legacy), album: 'Iceland L' };

        expect(component.gapAlbums).toEqual([]);
        expect(component.gapMessage).not.toContain('undefined');
      });
    });

    it('has nothing to explain on a whole pair', () => {
      expect(component.gapMessage).toBe('');
    });
  });
});
