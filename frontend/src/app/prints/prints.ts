import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { PrintsService } from './prints.service';
import { PhotoStackComponent } from './photo-stack/photo-stack';

@Component({
  selector: 'app-prints',
  templateUrl: './prints.html',
  imports: [PhotoStackComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './prints.scss',
})
export class PrintsComponent {
  private readonly prints = inject(PrintsService);

  /** Albums still to export/order, and albums ordered & awaiting placement. */
  readonly toPrint = this.prints.toPrint;
  readonly done = this.prints.done;

  /** "I've ordered these" — move the album into Done. */
  markOrdered(album: string): void {
    void this.prints.markOrdered(album);
  }

  /** Checkmark — the prints are placed; complete the album. */
  markPlaced(album: string): void {
    void this.prints.markPlaced(album);
  }
}
