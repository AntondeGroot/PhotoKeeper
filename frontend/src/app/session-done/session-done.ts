import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-session-done',
  templateUrl: './session-done.html',
  imports: [],
  styleUrl: './session-done.scss',
})
export class SessionDoneComponent {
  @Input() keptCount!: number;
  @Input() rejectedCount!: number;
  @Input() toEditCount!: number;
  @Input() maybeCount!: number;
  @Output() pipelineClick = new EventEmitter<void>();
}
