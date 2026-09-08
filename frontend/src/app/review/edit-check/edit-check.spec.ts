import { ComponentFixture, TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { EditCheckComponent } from './edit-check';
import { EditDetectionService, EditFinding } from '../edit-detection.service';
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
  let thumbnails: ReturnType<typeof signal<ReadonlyMap<string, SafeUrl>>>;

  function render(rows: EditFinding[], byHand: boolean) {
    findings = signal<EditFinding[] | null>(rows);
    picking = signal(byHand);
    sent = [];
    thumbnails = signal<ReadonlyMap<string, SafeUrl>>(new Map());
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [EditCheckComponent],
      providers: [
        {
          provide: EditDetectionService,
          useValue: {
            findings,
            picking,
            thumbnails,
            checking: signal(false),
            failed: signal(false),
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
});
