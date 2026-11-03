import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SetFinishService, SetFinishState } from '../set-finish.service';
import { FrameSetKind } from '../frame-sets';
import { SetFinishNoteComponent } from './set-finish-note';

describe('SetFinishNoteComponent', () => {
  /** Every call the buttons made to the service: its name, then what it was given. */
  let calls: unknown[][];

  /** Mounts the note for a two-frame row whose search stands at this state. */
  function render(state: SetFinishState, kind: FrameSetKind = 'pano'): HTMLElement {
    calls = [];
    const record =
      (name: string) =>
      (...args: unknown[]) => {
        calls.push([name, ...args]);
      };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: SetFinishService,
          useValue: {
            state: signal(new Map([['f1', state]])),
            finish: record('finish'),
            finishWithoutMerge: record('finishWithoutMerge'),
            sendFramesToPrint: record('sendFramesToPrint'),
            stopTrying: record('stopTrying'),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(SetFinishNoteComponent);
    fixture.componentRef.setInput('rowId', 'f1');
    fixture.componentRef.setInput('frameIds', ['f1', 'f2']);
    fixture.componentRef.setInput('kind', kind);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  /** The labels of the buttons on offer while a row's search stands at this state. */
  function buttonsWhile(
    state: SetFinishState,
    kind: FrameSetKind = 'pano',
  ): (string | undefined)[] {
    return [...render(state, kind).querySelectorAll('button')].map((b) => b.textContent?.trim());
  }

  /** Mounts the note at this state and presses the button with this label. */
  function press(state: SetFinishState, label: string, kind: FrameSetKind = 'pano'): void {
    const button = [...render(state, kind).querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === label,
    );
    button?.click();
  }

  /**
   * "Finish without a merge" gives up on the merged file for good, so it is only an honest offer once
   * the album has been read and the file was not in it. While still looking, or when Lightroom could
   * not be reached, nobody knows yet whether the file exists.
   */
  it('offers finishing without a merge only once the search has found nothing', () => {
    expect(buttonsWhile('searching')).toEqual([]);
    expect(buttonsWhile('unreachable')).toEqual(['Look again', 'Stop trying']);
    expect(buttonsWhile('not-found')).toEqual(['Look again', 'Finish without a merge']);
  });

  /**
   * Printing is the one thing that cannot be taken back. A burst may simply be a burst, so with no
   * merged file its frames can go to print, but only because someone pressed that. A sweep's frames
   * are never the photograph, so a panorama must not offer it at any point.
   */
  it('offers sending to print only for a burst with no merged file', () => {
    expect(buttonsWhile('not-found', 'burst')).toEqual([
      'Look again',
      'Send to print',
      'Keep, don’t print',
    ]);
    expect(buttonsWhile('searching', 'burst')).toEqual([]);
    expect(buttonsWhile('unreachable', 'burst')).toEqual(['Look again', 'Stop trying']);
    expect(buttonsWhile('not-found', 'pano')).not.toContain('Send to print');
  });

  /**
   * Each button says one thing and has to do exactly that. Mixed up, "Look again" would stand the
   * frames down for good, and "Stop trying" would leave a retry running that can still write.
   */
  it('does what each button says, for this row and its frames', () => {
    press('not-found', 'Look again');
    expect(calls).toEqual([['finish', 'f1', ['f1', 'f2']]]);

    press('not-found', 'Finish without a merge');
    expect(calls).toEqual([['finishWithoutMerge', 'f1', ['f1', 'f2']]]);

    press('unreachable', 'Look again');
    expect(calls).toEqual([['finish', 'f1', ['f1', 'f2']]]);

    press('unreachable', 'Stop trying');
    expect(calls).toEqual([['stopTrying', 'f1']]);
  });

  /**
   * These two sit side by side and go opposite ways, and only one of them writes to the print album.
   * Mixed up, "Keep, don't print" would put every frame there for good.
   */
  it('does what a burst\u2019s two choices say, for this row and its frames', () => {
    press('not-found', 'Send to print', 'burst');
    expect(calls).toEqual([['sendFramesToPrint', 'f1', ['f1', 'f2']]]);

    press('not-found', 'Keep, don’t print', 'burst');
    expect(calls).toEqual([['finishWithoutMerge', 'f1', ['f1', 'f2']]]);
  });
});
