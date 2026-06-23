import { Component, EventEmitter, Input, Output, ChangeDetectionStrategy } from '@angular/core';
import { SafeUrl } from '@angular/platform-browser';
import { Photo } from '../../photo';
import { SceneComponent } from '../scene/scene';

@Component({
  selector: 'app-review-edit',
  templateUrl: './review-edit.html',
  imports: [SceneComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './review-edit.scss',
})
export class ReviewEditComponent {
  @Input() queue: Photo[] = [];
  /** Frame-id → preview URL for the queued photos (a generated scene is shown when absent). */
  @Input() imageUrls = new Map<string, SafeUrl>();
  @Input() editDone: boolean = false;
  @Output() promoted = new EventEmitter<string>();
}
