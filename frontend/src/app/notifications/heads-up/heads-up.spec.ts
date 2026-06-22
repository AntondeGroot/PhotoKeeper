import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HeadsUpComponent } from './heads-up';
import { HeadsUp } from './heads-up.types';

const sample: HeadsUp = { icon: '🎉', title: "That's 15 — daily goal done", text: 'Lovely work.' };

describe('HeadsUpComponent', () => {
  let fixture: ComponentFixture<HeadsUpComponent>;
  let root: HTMLElement;

  beforeEach(async () => {
    vi.useFakeTimers();
    await TestBed.configureTestingModule({ imports: [HeadsUpComponent] }).compileComponents();
    fixture = TestBed.createComponent(HeadsUpComponent);
    root = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function render(message: HeadsUp | null): void {
    fixture.componentRef.setInput('message', message);
    fixture.detectChanges();
  }

  it('renders nothing when there is no message', () => {
    render(null);
    expect(root.querySelector('.heads-up')).toBeNull();
  });

  it('renders the icon, title and text of a celebration', () => {
    render(sample);
    expect(root.querySelector('.hu-icon')?.textContent?.trim()).toBe('🎉');
    expect(root.querySelector('.hu-title')?.textContent?.trim()).toBe(
      "That's 15 — daily goal done",
    );
    expect(root.querySelector('.hu-text')?.textContent?.trim()).toBe('Lovely work.');
  });

  it('auto-dismisses after the hold + slide-out', () => {
    render(sample);
    let dismissed = false;
    fixture.componentInstance.dismissed.subscribe(() => (dismissed = true));

    vi.advanceTimersByTime(3399); // still holding
    expect(dismissed).toBe(false);

    vi.advanceTimersByTime(601 + 600); // hold elapses, then the slide-out window
    expect(dismissed).toBe(true);
  });

  it('dismisses early when tapped', () => {
    render(sample);
    let dismissed = false;
    fixture.componentInstance.dismissed.subscribe(() => (dismissed = true));

    root.querySelector<HTMLButtonElement>('.heads-up')?.click();
    expect(dismissed).toBe(false); // waits out the slide-out first
    vi.advanceTimersByTime(600);
    expect(dismissed).toBe(true);
  });
});
