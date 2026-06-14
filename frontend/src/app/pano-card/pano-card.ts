import { Component, EventEmitter, Input, Output } from '@angular/core';
import { Pano } from '../photo';

@Component({
  selector: 'app-pano-card',
  templateUrl: './pano-card.html',
  styleUrl: './pano-card.scss',
  imports: [],
})
export class PanoCardComponent {
  @Input() pano!: Pano;
  @Output() swiped = new EventEmitter<'kept' | 'rejected' | 'toEdit' | 'maybe'>();
}
