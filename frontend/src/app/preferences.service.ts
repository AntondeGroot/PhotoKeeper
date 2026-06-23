import { Injectable, effect, signal } from '@angular/core';
import { DeviceFolder, DEVICE_FOLDERS } from './photo';
import { DEFAULT_TAG_DIRECTIONS, TagDirections } from './tagging/tags';

/** Reads + parses a JSON localStorage value, or null if absent/corrupt. */
function readJson(key: string): unknown {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Every user preference that persists to localStorage: review/edit/tag goals, reminders, the tagging
 * toggle + goal + swipe-direction map, vacation album ids, the device source, and the onboarded gate.
 * Each is a writable signal the rest of the app reads and writes directly; this service loads them once
 * on creation and saves any change through a single effect — so the persistence glue lives here instead
 * of scattered through the components.
 */
@Injectable({ providedIn: 'root' })
export class PreferencesService {
  readonly dailyGoal = signal(15);
  readonly editGoal = signal(3);
  readonly tagGoal = signal(15);
  readonly morningReminder = signal(true);
  readonly reminderTime = signal('09:00');
  readonly silentTime = signal('21:00');
  readonly silentEvening = signal(true);
  readonly taggingEnabled = signal(false);
  readonly stereoEnabled = signal(false);
  readonly tagDirections = signal<TagDirections>({ ...DEFAULT_TAG_DIRECTIONS });
  readonly vacationAlbumIds = signal<string[]>([]);
  readonly onboarded = signal(false);
  readonly deviceEnabled = signal(false);
  readonly deviceFolders = signal<DeviceFolder[]>(DEVICE_FOLDERS.map((f) => ({ ...f })));

  constructor() {
    this.restore();
    effect(() => this.persist());
  }

  private restore(): void {
    this.restoreScalars();
    this.restoreJson();
  }

  private restoreScalars(): void {
    const dailyGoal = localStorage.getItem('dailyGoal');
    if (dailyGoal) this.dailyGoal.set(Number(dailyGoal));
    const editGoal = localStorage.getItem('editGoal');
    if (editGoal) this.editGoal.set(Number(editGoal));
    const tagGoal = localStorage.getItem('tagGoal');
    if (tagGoal) this.tagGoal.set(Number(tagGoal));
    const reminderTime = localStorage.getItem('reminderTime');
    if (reminderTime) this.reminderTime.set(reminderTime);
    const silentTime = localStorage.getItem('silentTime');
    if (silentTime) this.silentTime.set(silentTime);
    const morningReminder = localStorage.getItem('morningReminder');
    if (morningReminder) this.morningReminder.set(morningReminder === 'true');
    const silentEvening = localStorage.getItem('silentEvening');
    if (silentEvening) this.silentEvening.set(silentEvening === 'true');
    this.taggingEnabled.set(localStorage.getItem('taggingEnabled') === 'true');
    this.stereoEnabled.set(localStorage.getItem('stereoEnabled') === 'true');
    this.onboarded.set(localStorage.getItem('onboarded') === 'true');
    this.deviceEnabled.set(localStorage.getItem('deviceEnabled') === 'true');
  }

  private restoreJson(): void {
    const dirs: unknown = readJson('tagDirections');
    if (dirs && typeof dirs === 'object') this.tagDirections.set(dirs);

    const vacation: unknown = readJson('vacationAlbumIds');
    if (Array.isArray(vacation)) {
      this.vacationAlbumIds.set(vacation.filter((id): id is string => typeof id === 'string'));
    }

    const folders: unknown = readJson('deviceFolders');
    if (Array.isArray(folders)) {
      const on = new Set(folders.filter((n): n is string => typeof n === 'string'));
      this.deviceFolders.update((list) => list.map((f) => ({ ...f, enabled: on.has(f.name) })));
    }
  }

  private persist(): void {
    localStorage.setItem('dailyGoal', String(this.dailyGoal()));
    localStorage.setItem('editGoal', String(this.editGoal()));
    localStorage.setItem('tagGoal', String(this.tagGoal()));
    localStorage.setItem('morningReminder', String(this.morningReminder()));
    localStorage.setItem('reminderTime', this.reminderTime());
    localStorage.setItem('silentTime', this.silentTime());
    localStorage.setItem('silentEvening', String(this.silentEvening()));
    localStorage.setItem('taggingEnabled', String(this.taggingEnabled()));
    localStorage.setItem('stereoEnabled', String(this.stereoEnabled()));
    localStorage.setItem('tagDirections', JSON.stringify(this.tagDirections()));
    localStorage.setItem('vacationAlbumIds', JSON.stringify(this.vacationAlbumIds()));
    localStorage.setItem('onboarded', String(this.onboarded()));
    localStorage.setItem('deviceEnabled', String(this.deviceEnabled()));
    // Persist only the per-folder enabled flags by name, so changing the folder catalogue later
    // doesn't strand stale entries.
    const enabledFolders = this.deviceFolders()
      .filter((f) => f.enabled)
      .map((f) => f.name);
    localStorage.setItem('deviceFolders', JSON.stringify(enabledFolders));
  }
}
