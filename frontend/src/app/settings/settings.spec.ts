import { SettingsComponent } from './settings';

// The handlers read `(event.target as HTMLInputElement).value`, so a minimal stub with a `target`
// holding a `value` is enough to drive them — no real DOM input element needed.
function inputEvent(value: string): Event {
  return { target: { value } } as unknown as Event;
}

describe('SettingsComponent', () => {
  let component: SettingsComponent;

  beforeEach(() => {
    component = new SettingsComponent();
  });

  it('has sensible default inputs', () => {
    expect(component.dailyGoal).toBe(15);
    expect(component.editGoal).toBe(3);
    expect(component.reminderTime).toBe('09:00');
    expect(component.silentTime).toBe('21:00');
    expect(component.silentEvening).toBe(false);
  });

  it('onDailyGoalChange emits the value parsed as a number', () => {
    let emitted: number | undefined;
    component.dailyGoalChange.subscribe((value) => (emitted = value));

    component.onDailyGoalChange(inputEvent('20'));

    expect(emitted).toBe(20);
  });

  it('onEditGoalChange emits the value parsed as a number', () => {
    let emitted: number | undefined;
    component.editGoalChange.subscribe((value) => (emitted = value));

    component.onEditGoalChange(inputEvent('7'));

    expect(emitted).toBe(7);
  });

  it('onReminderTimeChange emits the raw string value', () => {
    let emitted: string | undefined;
    component.reminderTimeChange.subscribe((value) => (emitted = value));

    component.onReminderTimeChange(inputEvent('08:30'));

    expect(emitted).toBe('08:30');
  });

  it('onSilentTimeChange emits the raw string value', () => {
    let emitted: string | undefined;
    component.silentTimeChange.subscribe((value) => (emitted = value));

    component.onSilentTimeChange(inputEvent('22:15'));

    expect(emitted).toBe('22:15');
  });
});
