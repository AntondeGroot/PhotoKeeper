import {
  Component,
  EventEmitter,
  Input,
  Output,
  ChangeDetectionStrategy,
  signal,
} from '@angular/core';
import { DeviceFolder } from '../photo';
import { DeviceSourceComponent } from '../device-source/device-source';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './settings.scss',
  imports: [DeviceSourceComponent],
})
export class SettingsComponent {
  @Input() dailyGoal = 15;
  @Input() editGoal = 3;
  @Input() tagGoal = 15;
  @Input() morningReminder: boolean = true;
  @Input() reminderTime: string = '09:00';
  @Input() silentTime: string = '21:00';
  @Input() silentEvening: boolean = false;
  @Input() taggingEnabled: boolean = false;
  @Input() burstWindowSeconds = 3;
  @Input() deviceEnabled = false;
  @Input() deviceFolders: DeviceFolder[] = [];
  @Input() lightroomConnected = false;
  @Input() lightroomConnecting = false;
  @Input() loginHref = '';
  @Output() dailyGoalChange = new EventEmitter<number>();
  @Output() burstWindowSecondsChange = new EventEmitter<number>();
  @Output() editGoalChange = new EventEmitter<number>();
  @Output() tagGoalChange = new EventEmitter<number>();
  @Output() morningReminderChange = new EventEmitter<boolean>();
  @Output() reminderTimeChange = new EventEmitter<string>();
  @Output() silentTimeChange = new EventEmitter<string>();
  @Output() silentEveningChange = new EventEmitter<boolean>();
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
    this.editGoalChange.emit(Number((event.target as HTMLInputElement).value));
  }

  onTagGoalChange(event: Event): void {
    this.tagGoalChange.emit(Number((event.target as HTMLInputElement).value));
  }

  onReminderTimeChange(event: Event): void {
    this.reminderTimeChange.emit((event.target as HTMLInputElement).value);
  }

  onSilentTimeChange(event: Event): void {
    this.silentTimeChange.emit((event.target as HTMLInputElement).value);
  }

  onBurstWindowChange(event: Event): void {
    this.burstWindowSecondsChange.emit(Number((event.target as HTMLInputElement).value));
  }
}
