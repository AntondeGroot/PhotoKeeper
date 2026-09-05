import {
  Component,
  EventEmitter,
  Input,
  OnInit,
  Output,
  ChangeDetectionStrategy,
  inject,
  signal,
} from '@angular/core';
import { DeviceSourceComponent } from '../device-source/device-source';
import { PreferencesService } from '../preferences.service';
import { BatteryOptimizationService } from '../notifications/battery-optimization.service';
import { StorageUsageService } from '../storage/storage-usage.service';
import { formatBytes } from '../storage/storage-usage';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './settings.scss',
  imports: [DeviceSourceComponent],
})
export class SettingsComponent implements OnInit {
  /** Android's background restriction — shown here because it decides whether reminders arrive. */
  readonly battery = inject(BatteryOptimizationService);

  /** What the app is keeping on the device, per kind of thing. */
  readonly storage = inject(StorageUsageService);

  ngOnInit(): void {
    // Re-read on open: the exemption is granted in a system dialog, so the app never sees it change.
    void this.battery.refresh();
    // Measured on open rather than kept live: it walks every stored record, which is far too much
    // work to be doing behind a screen nobody is looking at.
    void this.storage.measure();
  }

  protected readonly bytes = formatBytes;

  /** Record counts with thousands separators — "12,043" reads as a quantity, "12043" as an id. */
  protected count(records: number): string {
    return records.toLocaleString('en-GB');
  }

  /** How much of the total a group accounts for, for the bar under each row. */
  protected share(bytes: number): number {
    const total = this.storage.usage()?.total ?? 0;
    return total > 0 ? Math.round((bytes / total) * 100) : 0;
  }

  // Persisted preferences are read and written straight on PreferencesService — the host no longer
  // prop-drills them in. The template binds `prefs.<name>()` and writes `prefs.<name>.set(...)`.
  readonly prefs = inject(PreferencesService);

  // Inputs that remain are session/detection state the host owns (not preferences).
  @Input() burstWindowSeconds = 3;
  @Input() lightroomConnected = false;
  @Input() lightroomConnecting = false;
  @Input() loginHref = '';

  // Outputs remain only where the write carries a host-side side effect beyond setting the pref:
  // the sorting goal triggers a resample, tagging toggles the review mode, device flags re-sync the
  // deck. Pure-pref writes (editing/tagging goals, reminder times) happen directly on `prefs` above.
  @Output() dailyGoalChange = new EventEmitter<number>();
  @Output() burstWindowSecondsChange = new EventEmitter<number>();
  @Output() taggingEnabledChange = new EventEmitter<boolean>();
  @Output() manageAlbums = new EventEmitter<void>();
  @Output() manageTags = new EventEmitter<void>();
  @Output() deviceToggled = new EventEmitter<boolean>();
  @Output() folderToggled = new EventEmitter<string>();
  @Output() lightroomDisconnect = new EventEmitter<void>();

  /** Whether the inline "are you sure?" confirm is showing on the Lightroom card. */
  protected readonly confirmingDisconnect = signal(false);

  protected confirmDisconnect(): void {
    this.confirmingDisconnect.set(false);
    this.lightroomDisconnect.emit();
  }

  onDailyGoalChange(event: Event): void {
    this.dailyGoalChange.emit(Number((event.target as HTMLInputElement).value));
  }

  onEditGoalChange(event: Event): void {
    this.prefs.editGoal.set(Number((event.target as HTMLInputElement).value));
  }

  onTagGoalChange(event: Event): void {
    this.prefs.tagGoal.set(Number((event.target as HTMLInputElement).value));
  }

  onReminderTimeChange(event: Event): void {
    this.prefs.reminderTime.set((event.target as HTMLInputElement).value);
  }

  onSilentTimeChange(event: Event): void {
    this.prefs.silentTime.set((event.target as HTMLInputElement).value);
  }

  onBurstWindowChange(event: Event): void {
    this.burstWindowSecondsChange.emit(Number((event.target as HTMLInputElement).value));
  }
}
