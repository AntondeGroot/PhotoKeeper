import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  signal,
} from '@angular/core';
import { DeviceFolder } from '../photo';

// Persists "the user has seen the folder list open once", so it auto-expands the first time the device
// source is turned on and stays collapsed (compact) on every visit after.
const INTRO_SEEN_KEY = 'deviceFoldersIntroSeen';

function introSeen(): boolean {
  try {
    return localStorage.getItem(INTRO_SEEN_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * The "This device" source card: a master toggle plus, when on, the list of local folders to include
 * in review. Shared by Settings and the first-run Onboarding so both stay in sync. Stateless — the
 * host owns the enabled flags and persists them; this only renders and emits intents.
 */
@Component({
  selector: 'app-device-source',
  templateUrl: './device-source.html',
  styleUrl: './device-source.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeviceSourceComponent implements OnChanges {
  @Input() enabled = false;
  @Input() folders: DeviceFolder[] = [];

  /** Master "review photos from this device" toggle flipped. */
  @Output() toggled = new EventEmitter<boolean>();
  /** A single folder's include checkbox flipped (by folder name). */
  @Output() folderToggled = new EventEmitter<string>();

  /** Whether the folder list is expanded. Collapsed by default so the card stays compact. */
  protected readonly expanded = signal(false);

  // Auto-expand the folder list the first time the device source is switched on (so the user can
  // pick folders right away); on every later visit it opens collapsed.
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['enabled'] && this.enabled && !introSeen()) {
      this.expanded.set(true);
      try {
        localStorage.setItem(INTRO_SEEN_KEY, 'true');
      } catch {
        // Non-persistent storage (private mode) — at worst it auto-expands again next time.
      }
    }
  }

  protected enabledCount(): number {
    return this.folders.filter((f) => f.enabled).length;
  }

  protected formatCount(count: number): string {
    return `${count.toLocaleString('en-US')} photos`;
  }
}
