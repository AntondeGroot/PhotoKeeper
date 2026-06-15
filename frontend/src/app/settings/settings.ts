import { Component, EventEmitter, Input, Output, ChangeDetectionStrategy } from '@angular/core';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './settings.scss',
})
export class SettingsComponent {
  @Input() dailyGoal = 15;
  @Input() editGoal = 3;
  @Input() reminderTime: string = '09:00';
  @Input() silentTime: string = '21:00';
  @Input() silentEvening: boolean = false;
  @Output() dailyGoalChange = new EventEmitter<number>();
  @Output() editGoalChange = new EventEmitter<number>();
  @Output() reminderTimeChange = new EventEmitter<string>();
  @Output() silentTimeChange = new EventEmitter<string>();
  @Output() silentEveningChange = new EventEmitter<boolean>();

  onDailyGoalChange(event: Event): void {
    this.dailyGoalChange.emit(Number((event.target as HTMLInputElement).value));
  }

  onEditGoalChange(event: Event): void {
    this.editGoalChange.emit(Number((event.target as HTMLInputElement).value));
  }

  onReminderTimeChange(event: Event): void {
    this.reminderTimeChange.emit((event.target as HTMLInputElement).value);
  }

  onSilentTimeChange(event: Event): void {
    this.silentTimeChange.emit((event.target as HTMLInputElement).value);
  }
}
