import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SettingsComponent } from './settings';

// The handlers read `(event.target as HTMLInputElement).value`, so a minimal stub with a `target`
// holding a `value` is enough to drive them — no real DOM input element needed.
function inputEvent(value: string): Event {
  return { target: { value } } as unknown as Event;
}

describe('SettingsComponent', () => {
  let fixture: ComponentFixture<SettingsComponent>;
  let component: SettingsComponent;

  beforeEach(async () => {
    localStorage.clear(); // PreferencesService seeds from localStorage on construction
    await TestBed.configureTestingModule({ imports: [SettingsComponent] }).compileComponents();
    fixture = TestBed.createComponent(SettingsComponent);
    component = fixture.componentInstance;
  });

  it('keeps the host-owned inputs with sensible defaults', () => {
    expect(component.burstWindowSeconds).toBe(3);
    expect(component.lightroomConnected).toBe(false);
  });

  // The sorting goal still emits — the host debounces it into a resample. The editing/tagging goals
  // and reminder times now write straight to PreferencesService (no host involvement).
  it('onDailyGoalChange emits the value parsed as a number', () => {
    let emitted: number | undefined;
    component.dailyGoalChange.subscribe((value) => (emitted = value));

    component.onDailyGoalChange(inputEvent('20'));

    expect(emitted).toBe(20);
  });

  it('onEditGoalChange writes the editing goal straight to preferences', () => {
    component.onEditGoalChange(inputEvent('7'));
    expect(component.prefs.editGoal()).toBe(7);
  });

  it('onReminderTimeChange writes the reminder time straight to preferences', () => {
    component.onReminderTimeChange(inputEvent('08:30'));
    expect(component.prefs.reminderTime()).toBe('08:30');
  });

  it('onSilentTimeChange writes the silent time straight to preferences', () => {
    component.onSilentTimeChange(inputEvent('22:15'));
    expect(component.prefs.silentTime()).toBe('22:15');
  });
});

describe('SettingsComponent — Lightroom source card', () => {
  let fixture: ComponentFixture<SettingsComponent>;
  let root: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SettingsComponent] }).compileComponents();
    fixture = TestBed.createComponent(SettingsComponent);
    fixture.componentRef.setInput('loginHref', 'https://example.test/login');
    root = fixture.nativeElement as HTMLElement;
  });

  function render(inputs: { connected?: boolean; connecting?: boolean }): void {
    fixture.componentRef.setInput('lightroomConnected', inputs.connected ?? false);
    fixture.componentRef.setInput('lightroomConnecting', inputs.connecting ?? false);
    fixture.detectChanges();
  }

  it('offers a Connect link when Lightroom is not connected', () => {
    render({ connected: false });
    const link = root.querySelector<HTMLAnchorElement>('a.lr-connect');
    expect(link?.getAttribute('href')).toBe('https://example.test/login');
    expect(root.querySelector('.connected-chip')).toBeNull();
  });

  it('shows the golden spinner while verifying after the redirect', () => {
    render({ connecting: true });
    const button = root.querySelector<HTMLButtonElement>('.lr-connect.connecting');
    expect(button?.disabled).toBe(true);
    expect(button?.querySelector('.spinner')).not.toBeNull();
    expect(root.querySelector('a.lr-connect')).toBeNull();
  });

  it('shows the Connected chip plus a Disconnect button once connected', () => {
    render({ connected: true });
    expect(root.querySelector('.connected-chip')?.textContent?.trim()).toBe('Connected');
    expect(root.querySelector('.lr-connect')).toBeNull();
    expect(root.querySelector('.lr-disconnect')?.textContent?.trim()).toBe('Disconnect');
  });

  it('asks to confirm before disconnecting, and does not emit on the first click', () => {
    render({ connected: true });
    let disconnected = false;
    fixture.componentInstance.lightroomDisconnect.subscribe(() => (disconnected = true));

    root.querySelector<HTMLButtonElement>('.lr-disconnect')?.click();
    fixture.detectChanges();

    // The confirm prompt is now showing; nothing disconnected yet.
    expect(root.querySelector('.lr-confirm')).not.toBeNull();
    expect(disconnected).toBe(false);
  });

  it('Cancel dismisses the confirm without disconnecting', () => {
    render({ connected: true });
    let disconnected = false;
    fixture.componentInstance.lightroomDisconnect.subscribe(() => (disconnected = true));

    root.querySelector<HTMLButtonElement>('.lr-disconnect')?.click();
    fixture.detectChanges();
    root.querySelector<HTMLButtonElement>('.lr-cancel')?.click();
    fixture.detectChanges();

    expect(root.querySelector('.lr-confirm')).toBeNull();
    expect(root.querySelector('.lr-disconnect')).not.toBeNull(); // back to the plain button
    expect(disconnected).toBe(false);
  });

  it('emits lightroomDisconnect only after confirming', () => {
    render({ connected: true });
    let disconnected = false;
    fixture.componentInstance.lightroomDisconnect.subscribe(() => (disconnected = true));

    root.querySelector<HTMLButtonElement>('.lr-disconnect')?.click(); // open confirm
    fixture.detectChanges();
    root.querySelector<HTMLButtonElement>('.lr-disconnect.danger')?.click(); // confirm

    expect(disconnected).toBe(true);
  });
});
