import { Component, EventEmitter, Input, Output } from '@angular/core';
import { Photo } from '../photo';
import { PhotoCardComponent } from '../photo-card/photo-card';

@Component({
  selector: 'app-review-sort',
  templateUrl: './review-sort.html',
  imports: [PhotoCardComponent],
  styleUrl: './review-sort.scss',
})
export class ReviewSortComponent {
  @Input() photo!: Photo;
  @Output() swiped = new EventEmitter<'kept' | 'rejected' | 'toEdit' | 'maybe'>();
  @Output() starToggle = new EventEmitter<void>();
  @Output() keepsakeToggle = new EventEmitter<void>();
}
