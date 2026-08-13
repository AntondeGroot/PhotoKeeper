import { ComponentFixture, TestBed } from '@angular/core/testing';
import { StreakFrozenNoticeComponent } from './streak-frozen-notice';

describe('StreakFrozenNoticeComponent', () => {
  let fixture: ComponentFixture<StreakFrozenNoticeComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StreakFrozenNoticeComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(StreakFrozenNoticeComponent);
  });

  /** Renders the notice and returns its text, whitespace collapsed. */
  function render(daysCovered: number, freezesLeft: number, streakDays = 0): string {
    fixture.componentRef.setInput('daysCovered', daysCovered);
    fixture.componentRef.setInput('freezesLeft', freezesLeft);
    fixture.componentRef.setInput('streakDays', streakDays);
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).textContent.replace(/\s+/g, ' ').trim();
  }

  it('says how many days were covered, and what it left behind', () => {
    expect(render(1, 2, 73)).toContain('You missed a day.');
    expect(render(1, 2, 73)).toContain('A freeze covered it — 2 left.');
    expect(render(1, 2, 73)).toContain('Still going: 73 days.');
  });

  it('pluralises a longer absence, and warns when that was the last freeze', () => {
    const text = render(3, 0, 61);

    expect(text).toContain('You missed 3 days.');
    // Three days cost three freezes, and with none left the sentence changes shape rather than
    // reading "— 0 left", which sounds like a balance rather than a warning.
    expect(text).toContain('3 freezes covered it. That was your last one.');
    expect(text).not.toContain('left.');

    // A broken run has nothing to boast about, so that line goes entirely.
    expect(render(1, 0)).not.toContain('Still going');
  });
});
