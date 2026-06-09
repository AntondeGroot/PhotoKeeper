import { Component, Input } from '@angular/core';
import { Photo } from '../photo';

@Component({
  selector: 'app-photo-card',
  templateUrl: './photo-card.html',
  imports: [],
  styleUrl: './photo-card.scss',
})
export class PhotoCardComponent {
  @Input() photo!: Photo;
}
