import { Component, Input } from '@angular/core';
import { AlbumGroup } from '../photo';

@Component({
  selector: 'app-pipeline',
  templateUrl: './pipeline.html',
  imports: [],
  styleUrl: './pipeline.scss',
})
export class PipelineComponent {
  @Input() toEditByAlbum: AlbumGroup[] = [];
  @Input() toPrintByAlbum: AlbumGroup[] = [];
}
