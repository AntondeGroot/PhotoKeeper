import { TestBed } from '@angular/core/testing';
import { PreferencesService } from './preferences.service';

function make(): PreferencesService {
  // Each call gets a fresh injector so the service re-reads localStorage in its constructor.
  return TestBed.runInInjectionContext(() => new PreferencesService());
}

describe('PreferencesService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
  });

  it('starts from the documented defaults when storage is empty', () => {
    const prefs = make();
    expect(prefs.dailyGoal()).toBe(15);
    expect(prefs.editGoal()).toBe(3);
    expect(prefs.tagGoal()).toBe(15);
    expect(prefs.morningReminder()).toBe(true);
    expect(prefs.silentEvening()).toBe(true);
    expect(prefs.taggingEnabled()).toBe(false);
    expect(prefs.onboarded()).toBe(false);
    expect(prefs.tagDirections().left).toBe('animals');
  });

  it('restores scalar + JSON preferences from localStorage', () => {
    localStorage.setItem('dailyGoal', '20');
    localStorage.setItem('taggingEnabled', 'true');
    localStorage.setItem('reminderTime', '08:30');
    localStorage.setItem('tagDirections', JSON.stringify({ up: 'family' }));
    localStorage.setItem('vacationAlbumIds', JSON.stringify(['alb-1', 'alb-2']));

    const prefs = make();

    expect(prefs.dailyGoal()).toBe(20);
    expect(prefs.taggingEnabled()).toBe(true);
    expect(prefs.reminderTime()).toBe('08:30');
    expect(prefs.tagDirections()).toEqual({ up: 'family' });
    expect(prefs.vacationAlbumIds()).toEqual(['alb-1', 'alb-2']);
  });

  it('merges stored device-folder selections by name onto the catalogue', () => {
    localStorage.setItem('deviceEnabled', 'true');
    localStorage.setItem('deviceFolders', JSON.stringify(['Screenshots']));

    const prefs = make();

    expect(prefs.deviceEnabled()).toBe(true);
    const byName = new Map(prefs.deviceFolders().map((f) => [f.name, f.enabled]));
    expect(byName.get('Screenshots')).toBe(true);
    expect(byName.get('Camera')).toBe(false); // not in the stored set
  });

  it('ignores corrupt JSON without throwing', () => {
    localStorage.setItem('tagDirections', '{not json');
    const prefs = make();
    expect(prefs.tagDirections().left).toBe('animals'); // fell back to the default
  });
});
