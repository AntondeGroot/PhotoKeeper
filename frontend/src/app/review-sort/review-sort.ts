import { Component, EventEmitter, Input, Output, ChangeDetectionStrategy } from '@angular/core';
import { SafeUrl } from '@angular/platform-browser';
import { Photo } from '../photo';
import { PhotoCardComponent } from '../photo-card/photo-card';

@Component({
  selector: 'app-review-sort',
  templateUrl: './review-sort.html',
  imports: [PhotoCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './review-sort.scss',
})
export class ReviewSortComponent {
  @Input() photo!: Photo;
  @Input() imageUrl: SafeUrl | null = null;
  @Output() swiped = new EventEmitter<'kept' | 'rejected' | 'toEdit' | 'maybe'>();
  @Output() starToggle = new EventEmitter<void>();
  @Output() keepsakeToggle = new EventEmitter<void>();
}
