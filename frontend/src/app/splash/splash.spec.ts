import { ComponentFixture, TestBed } from '@angular/core/testing';
import { OfflineReason, SplashComponent, SplashState } from './splash';

describe('SplashComponent', () => {
  let fixture: ComponentFixture<SplashComponent>;
  let component: SplashComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SplashComponent] }).compileComponents();
    fixture = TestBed.createComponent(SplashComponent);
    component = fixture.componentInstance;
  });

  function render(state: SplashState, offlineReason: OfflineReason = 'device'): HTMLElement {
    fixture.componentRef.setInput('state', state);
    fixture.componentRef.setInput('offlineReason', offlineReason);
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
    expect(root.querySelector('.notice h2')?.textContent?.trim()).toBe('Working from this phone');
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

  /**
   * A backend that answers to say Lightroom is failing is not the same as having no connection, and
   * the advice differs: telling someone to check their Wi-Fi when their Wi-Fi is fine sends them off
   * to fix nothing. The app used to be unable to tell the two apart at all — the CDN swallowed the
   * backend's error — so it called both of them offline.
   */
  it('blames the connection only when the connection is the problem', () => {
    expect(render('offline', 'device').querySelector('.notice p')?.textContent).toContain(
      'No connection',
    );

    const lightroom = render('offline', 'lightroom').querySelector('.notice p')?.textContent;
    expect(lightroom).toContain("Lightroom isn't answering");
    expect(lightroom).not.toContain('No connection');
  });
});
