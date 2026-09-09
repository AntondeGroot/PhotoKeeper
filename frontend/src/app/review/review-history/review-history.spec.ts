import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReviewHistoryComponent } from './review-history';
import { PreviewCacheService } from '../preview-cache.service';
import { UndoEntry } from '../review-undo.service';
import { Burst, Photo } from '../../photo';

const photo = (id: string, album: string | null = 'Iceland'): Photo => ({
  id,
  name: `${id}.NEF`,
  album,
  taken: '2026-01-01',
  status: 'kept',
  kind: 'photo',
  starred: false,
  saveOnly: false,
});

const burst = (id: string, frameIds: string[]): Burst => ({
  id,
  name: `Burst · ${frameIds.length} frames`,
  album: 'Iceland',
  taken: '2026-01-01',
  status: 'kept',
  kind: 'burst',
  photos: frameIds.map((fid) => ({ id: fid, name: fid })),
});

const entry = (unit: Photo | Burst, outcome: UndoEntry['outcome']): UndoEntry => ({
  outcome,
  unit,
  returnTo: 'cursor',
  verdicts: new Map(),
});

describe('ReviewHistoryComponent', () => {
  let fixture: ComponentFixture<ReviewHistoryComponent>;
  let root: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReviewHistoryComponent],
      providers: [{ provide: PreviewCacheService, useValue: { url: () => null } }],
    }).compileComponents();
    fixture = TestBed.createComponent(ReviewHistoryComponent);
    root = fixture.nativeElement as HTMLElement;
  });

  function render(entries: UndoEntry[]): void {
    fixture.componentRef.setInput('entries', entries);
    fixture.detectChanges();
  }

  it('shows each decision with the judgement it was given', () => {
    render([entry(photo('a'), 'rejected'), entry(photo('b'), 'kept')]);

    const chips = [...root.querySelectorAll('.chip')].map((c) => c.textContent?.trim());
    expect(chips).toEqual(['Rejected', 'Kept']);
    expect(root.querySelector('.name')?.textContent?.trim()).toBe('a.NEF');
  });

  /** A skip is not a verdict — nothing was stored — but it still has to be takeable back. */
  it('shows a skipped unit as skipped rather than as a verdict', () => {
    render([entry(photo('a'), 'skipped')]);

    expect(root.querySelector('.chip')?.textContent?.trim()).toBe('Skipped');
  });

  /** A group is one row but several photographs, and a row that hid that would misreport the work. */
  it('says how many frames a group stands for', () => {
    render([entry(burst('burst:1', ['f1', 'f2', 'f3']), 'kept')]);

    expect(root.querySelector('.where')?.textContent).toContain('3 frames');
  });

  /**
   * A tag decision in the same list as the verdicts. The chip has to name the *tag*: "Tagged" would
   * leave out the only part worth checking, which is where that swipe actually went.
   */
  it('names a tag decision by its tag, beside the photograph', () => {
    render([
      {
        outcome: 'tagged',
        unit: photo('a'),
        returnTo: 'place',
        verdicts: new Map(),
        label: 'Animals',
        tag: { previous: [], cursor: 3, counted: true },
      },
    ]);

    expect(root.querySelector('.chip')?.textContent?.trim()).toBe('Animals');
    expect(root.querySelector('.name')?.textContent?.trim()).toContain('a');
  });

  /** Without a label of its own, a row still says something rather than nothing. */
  it('falls back to the outcome when an entry carries no label', () => {
    render([entry(photo('a'), 'tagged')]);

    expect(root.querySelector('.chip')?.textContent?.trim()).toBe('Tagged');
  });

  /**
   * Amber is "to edit" everywhere else — the card's ↑, the viewer's Edit — and this row said teal,
   * which is the Prints colour and so a different answer. Print keeps teal; it earns it.
   */
  it('colours a verdict the way the rest of the app states it', () => {
    render([entry(photo('a'), 'toEdit'), entry(photo('b'), 'toPrint')]);

    const chips = [...root.querySelectorAll('.chip')].map(
      (c) => [...c.classList].find((name) => name.startsWith('chip-')) ?? '',
    );
    expect(chips).toEqual(['chip-amber', 'chip-print']);
  });

  it('emits the entry whose Undo was pressed', () => {
    const entries = [entry(photo('a'), 'kept'), entry(photo('b'), 'rejected')];
    render(entries);
    let taken: UndoEntry | null = null;
    fixture.componentInstance.undone.subscribe((e: UndoEntry) => (taken = e));

    root.querySelectorAll<HTMLButtonElement>('.take-back')[1].click();

    expect(taken).toBe(entries[1]);
  });

  it('says so when there is nothing left to take back', () => {
    render([]);

    expect(root.querySelector('.empty')?.textContent?.trim()).toBe('Nothing to take back yet.');
  });
});
