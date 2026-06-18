import { Component, EventEmitter, Input, Output, ChangeDetectionStrategy } from '@angular/core';

@Component({
  selector: 'app-session-done',
  templateUrl: './session-done.html',
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './session-done.scss',
})
export class SessionDoneComponent {
  @Input() keptCount!: number;
  @Input() rejectedCount!: number;
  @Input() toEditCount!: number;
  @Input() maybeCount!: number;
  @Input() canLoadMore = true;
  @Output() pipelineClick = new EventEmitter<void>();
  @Output() loadMore = new EventEmitter<void>();
}
