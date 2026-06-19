import { ComponentFixture, TestBed } from '@angular/core/testing';
import { OnboardingComponent } from './onboarding';
import { DEVICE_FOLDERS } from '../photo';

describe('OnboardingComponent', () => {
  let fixture: ComponentFixture<OnboardingComponent>;
  let component: OnboardingComponent;
  let root: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [OnboardingComponent] }).compileComponents();
    fixture = TestBed.createComponent(OnboardingComponent);
    component = fixture.componentInstance;
    root = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('loginHref', 'https://example.test/login');
    fixture.componentRef.setInput('deviceFolders', DEVICE_FOLDERS);
  });

  function render(inputs: {
    connected?: boolean;
    connecting?: boolean;
    canContinue?: boolean;
  }): void {
    fixture.componentRef.setInput('connected', inputs.connected ?? false);
    fixture.componentRef.setInput('connecting', inputs.connecting ?? false);
    fixture.componentRef.setInput('canContinue', inputs.canContinue ?? false);
    fixture.detectChanges();
  }

  it('shows the connect link when Lightroom is not connected', () => {
    render({ connected: false });
    const link = root.querySelector<HTMLAnchorElement>('.btn-connect');
    expect(link?.getAttribute('href')).toBe('https://example.test/login');
    expect(root.querySelector('.source-check')).toBeNull();
  });

  it('shows a golden spinner (not the connect link) while verifying after the redirect', () => {
    render({ connected: false, connecting: true });
    const button = root.querySelector<HTMLButtonElement>('.btn-connect.connecting');
    expect(button).not.toBeNull();
    expect(button?.disabled).toBe(true);
    expect(button?.querySelector('.spinner')).not.toBeNull();
    // No tappable connect link or premature checkmark while still waiting.
    expect(root.querySelector('a.btn-connect')).toBeNull();
    expect(root.querySelector('.source-check')).toBeNull();
  });

  it('shows a green check and Connected chip once Lightroom is connected', () => {
    render({ connected: true });
    expect(root.querySelector('.source-check')).not.toBeNull();
    expect(root.querySelector('.btn-connect')).toBeNull();
    expect(root.querySelector('.connected-chip')?.textContent?.trim()).toBe('Connected');
  });

  it('disables Continue until a source is set up', () => {
    render({ canContinue: false });
    const button = root.querySelector<HTMLButtonElement>('.btn-continue');
    expect(button?.disabled).toBe(true);
    expect(root.querySelector('.continue-hint')).not.toBeNull();
  });

  it('enables Continue and emits when a source is ready', () => {
    render({ canContinue: true });
    let continued = false;
    component.continued.subscribe(() => (continued = true));
    const button = root.querySelector<HTMLButtonElement>('.btn-continue');

    expect(button?.disabled).toBe(false);
    button?.click();

    expect(continued).toBe(true);
  });
});
