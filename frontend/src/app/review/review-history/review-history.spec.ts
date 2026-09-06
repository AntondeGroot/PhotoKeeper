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
