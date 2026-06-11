import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class SettingsComponent {
  @Input() dailyGoal = 15;
  @Input() editGoal = 3;
  @Output() dailyGoalChange = new EventEmitter<number>();
  @Output() editGoalChange = new EventEmitter<number>();

  onDailyGoalChange(event: Event): void {
    this.dailyGoalChange.emit(Number((event.target as HTMLInputElement).value));
  }

  onEditGoalChange(event: Event): void {
    this.editGoalChange.emit(Number((event.target as HTMLInputElement).value));
  }
}
