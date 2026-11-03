import { SetFinishService, SetFinishState } from '../set-finish.service';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { EditCheckComponent } from './edit-check';
import { EditDetectionService, EditFinding } from '../edit-detection.service';
import { MergedPhoto } from '../merged-photo';
import { edited } from '../edit-detection';

const finding = (assetId: string, state: EditFinding['state']): EditFinding => ({
  assetId,
  state,
  name: `${assetId}.NEF`,
});

describe('EditCheckComponent', () => {
  let fixture: ComponentFixture<EditCheckComponent>;
  let root: HTMLElement;
  let findings: ReturnType<typeof signal<EditFinding[] | null>>;
  let picking: ReturnType<typeof signal<boolean>>;
  let sent: string[][];
  /** Panoramas sent looking for their merged file: the row, and the frames behind it. */
  let searches: [string, readonly string[]][];
  /** Sets sent straight to print: the row, and the frames behind it. */
  let printed: [string, readonly string[]][];
  let thumbnails: ReturnType<typeof signal<ReadonlyMap<string, SafeUrl>>>;
  /** Sweeps the check found already merged into a panorama. */
  let merges: ReturnType<typeof signal<MergedPhoto[]>>;
  /** Which merges the panel settled — what "That's the panorama" does. */
  let settled: string[];
  /** How far each card's check has got. */
  let finishStates: ReturnType<typeof signal<ReadonlyMap<string, SetFinishState>>>;

  function render(
    rows: EditFinding[],
    byHand: boolean,
    found: MergedPhoto[] = [],
    failure: 'none' | 'unreadable' | 'no-album' = 'none',
    detail: string | null = null,
  ) {
    findings = signal<EditFinding[] | null>(rows);
    picking = signal(byHand);
    sent = [];
    searches = [];
    printed = [];
    thumbnails = signal<ReadonlyMap<string, SafeUrl>>(new Map());
    merges = signal<MergedPhoto[]>(found);
    settled = [];
    finishStates = signal(new Map());
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [EditCheckComponent],
      providers: [
        {
          provide: SetFinishService,
          useValue: {
            state: finishStates,
            finish: (rowId: string, frameIds: readonly string[]) => {
              searches.push([rowId, frameIds]);
              return Promise.resolve();
            },
            sendFramesToPrint: (rowId: string, frameIds: readonly string[]) => {
              printed.push([rowId, frameIds]);
              return Promise.resolve();
            },
            cardTapped: (merge: { mergedId: string }) => {
              settled.push(merge.mergedId);
              return Promise.resolve();
            },
          },
        },
        {
          provide: EditDetectionService,
          useValue: {
            findings,
            picking,
            thumbnails,
            checking: signal(false),
            // Mirrors the real service, where one is derived from the other.
            failed: computed(() => failure !== 'none'),
            failure: signal(failure),
            failureDetail: signal(detail),
            editedFindings: computed(() => edited(findings() ?? [])),
            // Mirrors the real computed; the rule itself is pinned in the service's own spec.
            shownFindings: computed(() =>
              picking() ? (findings() ?? []) : edited(findings() ?? []),
            ),
            closePanel: () => undefined,
            sendToPrint: (ids: string[]) => {
              sent.push(ids);
              return Promise.resolve();
            },
            keepEditing: () => Promise.resolve(),
            merges,
          },
        },
      ],
    });
    fixture = TestBed.createComponent(EditCheckComponent);
    fixture.detectChanges();
    root = fixture.nativeElement as HTMLElement;
  }

  const names = () => [...root.querySelectorAll('.check-name')].map((el) => el.textContent?.trim());
  const ticked = () => root.querySelectorAll('.tile.on').length;
  const sendButton = () => root.querySelector<HTMLButtonElement>('.send');

  describe('after a check', () => {
    /**
     * A photo whose revision moved without the picture changing is deliberately not offered: sending
     * it on would print the version that was already there.
     */
    it('lists only the photos whose picture changed', () => {
      render([finding('a', 'edited'), finding('b', 'touched'), finding('c', 'unknown')], false);

      expect(names()).toEqual(['a.NEF']);
    });

    /** The check has already done the deciding, so its answer is the one on the button. */
    it('starts with everything it found ticked', () => {
      render([finding('a', 'edited'), finding('b', 'edited')], false);

      expect(ticked()).toBe(2);
      expect(sendButton()?.textContent?.trim()).toBe('Send 2 to print →');
    });

    /**
     * Nothing merges a stereo pair, so a search could only end in "nothing found". Sent from here as
     * from the Edit tab, it goes to print as one set: both eyes, one edit, and not as a lone frame.
     */
    it('sends a ticked stereo row straight to print, with both eyes', () => {
      render(
        [
          {
            ...finding('right', 'edited'),
            name: 'Stereo · 2 frames',
            setKind: 'stereo',
            setFrames: [finding('left', 'untouched'), finding('right', 'edited')],
          },
        ],
        false,
      );

      sendButton()?.click();

      expect(printed).toEqual([['right', ['left', 'right']]]);
      expect(searches).toEqual([]);
      expect(sent).toEqual([[]]);
    });

    /**
     * The panel's own wiring to the note, as the Edit tab has its own. Told the wrong kind, a burst
     * would talk about a panorama and lose the choice of printing, leaving only "Finish without a
     * merge" for what may simply be a burst.
     */
    it('tells the note a burst row is a burst', () => {
      render(
        [
          {
            ...finding('s2', 'edited'),
            name: 'Burst · 2 frames',
            setKind: 'burst',
            setFrames: [finding('s1', 'untouched'), finding('s2', 'edited')],
          },
        ],
        false,
      );

      finishStates.set(new Map([['s2', 'not-found']]));
      fixture.detectChanges();

      const note = root.querySelector('app-set-finish-note')?.textContent ?? '';
      expect(note).toContain('No merged HDR in this album yet');
      expect(note).toContain('Send to print');
    });

    /**
     * A panorama's frames must never reach the print album, which cannot be undone, so a ticked sweep
     * goes looking for its merged file while an ordinary photo goes to print. An unticked sweep does
     * neither: finding its file would confirm it, and nobody said it was finished.
     */
    it('sends a ticked panorama to look for its merged file, never to print', () => {
      const sweep = (lead: string, ...frames: string[]): EditFinding => ({
        ...finding(lead, 'edited'),
        name: `Panorama · ${frames.length} frames`,
        setKind: 'pano',
        setFrames: frames.map((id) => finding(id, id === lead ? 'edited' : 'untouched')),
      });
      render(
        [sweep('f3', 'f1', 'f2', 'f3'), finding('solo', 'edited'), sweep('g1', 'g1', 'g2')],
        false,
      );
      root.querySelectorAll<HTMLButtonElement>('.tile')[2].click();
      fixture.detectChanges();

      sendButton()?.click();

      expect(searches).toEqual([['f3', ['f1', 'f2', 'f3']]]);
      expect(sent).toEqual([['solo']]);
    });
  });

  describe('a list asked for by hand', () => {
    it('lists everything still waiting, whatever the app makes of it', () => {
      render([finding('a', 'edited'), finding('b', 'touched'), finding('c', 'unknown')], true);

      expect(names()).toEqual(['a.NEF', 'b.NEF', 'c.NEF']);
    });

    /**
     * Empty, not full: picking is the whole reason for asking, and a list that arrives pre-ticked
     * would send the entire queue to print on one mis-tap of the button below it.
     */
    it('starts with nothing ticked', () => {
      render([finding('a', 'unknown'), finding('b', 'unknown')], true);

      expect(ticked()).toBe(0);
      expect(sendButton()?.disabled).toBe(true);
    });

    it('sends exactly what was ticked', () => {
      render([finding('a', 'unknown'), finding('b', 'unknown')], true);

      root.querySelectorAll<HTMLButtonElement>('.tile')[1].click();
      fixture.detectChanges();
      sendButton()?.click();

      expect(sent).toEqual([['b']]);
    });

    /**
     * The complaint this answers: a column of filenames is not something anyone can pick from.
     * Nobody knows which shot DSC_4471.NEF is; they know it when they see it.
     */
    it('shows the photograph, not just its name', () => {
      render([finding('a', 'unknown'), finding('b', 'unknown')], true);
      const url = TestBed.inject(DomSanitizer).bypassSecurityTrustUrl('data:image/png;base64,AAAA');

      thumbnails.set(new Map([['a', url]]));
      fixture.detectChanges();

      expect(root.querySelectorAll('.tile-img')).toHaveLength(1);
      // The row whose preview has not arrived still stands there, with a space where it will go.
      expect(root.querySelectorAll('.tile-blank')).toHaveLength(1);
      expect(names()).toEqual(['a.NEF', 'b.NEF']);
    });

    it('says what the list is, rather than what was compared', () => {
      render([finding('a', 'unknown')], true);

      expect(root.querySelector('.check-note')?.textContent).toContain('Tick the ones you have');
      expect(root.querySelector('#check-title')?.textContent?.trim()).toBe('Which ones are done?');
    });
  });

  /**
   * A merged panorama is a bigger answer than any row below it: one press settles a whole sweep, so
   * it is shown as its own card rather than as another tile to tick.
   */
  describe('frames already merged into one photograph', () => {
    const merge: MergedPhoto = {
      mergedId: 'm1',
      mergedName: 'DSC_6470-Pano',
      kind: 'panorama',
      frameIds: ['f1', 'f2', 'f3'],
    };

    it('names the merge and says how many frames it came from', () => {
      render([finding('a', 'untouched')], false, [merge]);

      const card = root.querySelector('.merge-list');
      expect(card?.textContent).toContain('DSC_6470-Pano');
      expect(card?.textContent).toContain('3 frames');
    });

    it('settles the set when the merge is confirmed', () => {
      render([], false, [merge]);

      root.querySelector<HTMLButtonElement>('.merge-done')?.click();

      expect(settled).toEqual(['m1']);
    });

    /** Its own copy of the Edit tab card's markup, so it has to be held to the same three states. */
    it('shows how its check is going, and offers to stop while waiting to retry', () => {
      render([], false, [merge]);
      const button = () => root.querySelector<HTMLButtonElement>('.merge-done');
      const card = () => root.querySelector('.merge-list')?.textContent ?? '';
      const waitingMessage = 'Couldn’t reach Lightroom. Will try again when you’re back online.';

      expect(button()?.textContent?.trim()).toBe('That’s the panorama');
      expect(button()?.disabled).toBe(false);
      expect(card()).not.toContain(waitingMessage);

      finishStates.set(new Map([['m1', 'searching']]));
      fixture.detectChanges();
      expect(button()?.textContent?.trim()).toBe('That’s the panorama');
      expect(button()?.disabled).toBe(true);
      expect(card()).not.toContain(waitingMessage);

      finishStates.set(new Map([['m1', 'unreachable']]));
      fixture.detectChanges();
      expect(button()?.textContent?.trim()).toBe('Stop trying');
      expect(button()?.disabled).toBe(false);
      expect(card()).toContain(waitingMessage);
    });

    /** Nothing merged, nothing said: the panel is about edits, and this card is not always relevant. */
    it('shows no card when nothing has been merged', () => {
      render([finding('a', 'edited')], false);

      expect(root.querySelector('.merge-list')).toBeNull();
    });
  });

  /**
   * When "try again in a moment" is not the answer, someone has to be able to say what actually
   * happened. The reason is shown quietly under the apology rather than kept for a log nobody reads.
   */
  describe('when the check could not run', () => {
    it('shows what went wrong underneath', () => {
      render([], false, [], 'unreadable', 'HTTP 504 Gateway Timeout — api/albums/al-9/assets');

      expect(root.querySelector('.check-detail')?.textContent).toContain('HTTP 504');
    });

    /** An album nobody has made is not a network problem, and saying so sends them somewhere useless. */
    it('says an album is missing rather than blaming the connection', () => {
      render([], false, [], 'no-album');

      const note = root.querySelector('.check-note')?.textContent ?? '';
      expect(note).toContain('haven’t made a KeeperEdit album');
      expect(note).not.toContain('Couldn’t read');
    });

    it('shows no reason when there is none to show', () => {
      render([finding('a', 'edited')], false);

      expect(root.querySelector('.check-detail')).toBeNull();
    });
  });
});
