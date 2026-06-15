import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { AlbumGroup } from '../photo';

@Component({
  selector: 'app-pipeline',
  templateUrl: './pipeline.html',
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './pipeline.scss',
})
export class PipelineComponent {
  @Input() toEditByAlbum: AlbumGroup[] = [];
  @Input() toPrintByAlbum: AlbumGroup[] = [];
}
