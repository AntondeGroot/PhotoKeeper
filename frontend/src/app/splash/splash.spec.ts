import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SplashComponent, SplashState } from './splash';

describe('SplashComponent', () => {
  let fixture: ComponentFixture<SplashComponent>;
  let component: SplashComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SplashComponent] }).compileComponents();
    fixture = TestBed.createComponent(SplashComponent);
    component = fixture.componentInstance;
  });

  function render(state: SplashState): HTMLElement {
    fixture.componentRef.setInput('state', state);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function buttonByText(root: HTMLElement, text: string): HTMLButtonElement {
    const button = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent?.trim() === text,
    );
    if (!button) throw new Error(`No button with label "${text}"`);
    return button;
  }

  it('always develops the print and the wordmark', () => {
    const root = render('normal');
    expect(root.querySelector('.mark')).not.toBeNull();
    expect(root.querySelector('.word')?.textContent?.trim()).toBe('Keeper');
  });

  it('shows no notice in the normal state', () => {
    const root = render('normal');
    expect(root.querySelector('.notice')).toBeNull();
  });

  it('offline offers Continue, which emits "continued"', () => {
    const root = render('offline');
    expect(root.querySelector('.notice h2')?.textContent?.trim()).toBe('Working offline');
    let continued = false;
    component.continued.subscribe(() => (continued = true));

    buttonByText(root, 'Continue').click();

    expect(continued).toBe(true);
  });

  it('offline "Don\'t remind me" toggles on click without dismissing', () => {
    const root = render('offline');
    const check = root.querySelector<HTMLButtonElement>('.check');

    check?.click();
    fixture.detectChanges();

    expect(check?.classList.contains('on')).toBe(true);
  });

  it('update offers Update (emits "updateRequested") and Later (emits "continued")', () => {
    const root = render('update');
    let updateRequested = false;
    let continued = false;
    component.updateRequested.subscribe(() => (updateRequested = true));
    component.continued.subscribe(() => (continued = true));

    buttonByText(root, 'Update').click();
    buttonByText(root, 'Later').click();

    expect(updateRequested).toBe(true);
    expect(continued).toBe(true);
  });

  it('forced is a hard stop: only Update Keeper, which emits "updateRequested"', () => {
    const root = render('forced');
    expect(root.querySelector('.notice h2')?.textContent?.trim()).toBe('Update required');
    expect(root.querySelector('.btn.ghost')).toBeNull(); // no Later / Continue escape hatch
    let updateRequested = false;
    component.updateRequested.subscribe(() => (updateRequested = true));

    buttonByText(root, 'Update Keeper').click();

    expect(updateRequested).toBe(true);
  });
});
