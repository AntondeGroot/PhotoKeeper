import { Component, EventEmitter, Input, Output, ChangeDetectionStrategy } from '@angular/core';
import { Photo } from '../../photo';

@Component({
  selector: 'app-review-edit',
  templateUrl: './review-edit.html',
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './review-edit.scss',
})
export class ReviewEditComponent {
  @Input() queue: Photo[] = [];
  @Input() editDone: boolean = false;
  @Output() promoted = new EventEmitter<string>();
}
