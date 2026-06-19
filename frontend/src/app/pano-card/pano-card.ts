import { Component, EventEmitter, Input, Output, ChangeDetectionStrategy } from '@angular/core';
import { SafeUrl } from '@angular/platform-browser';
import { Pano } from '../photo';

@Component({
  selector: 'app-pano-card',
  templateUrl: './pano-card.html',
  styleUrl: './pano-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
})
export class PanoCardComponent {
  @Input() pano!: Pano;
  /** Frame-id → preview URL; frames without a cached preview fall back to a name placeholder. */
  @Input() imageUrls = new Map<string, SafeUrl>();
  @Output() swiped = new EventEmitter<'kept' | 'rejected' | 'toEdit' | 'maybe'>();
}
