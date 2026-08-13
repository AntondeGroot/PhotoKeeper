import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { PrintsService } from './prints.service';
import { PhotoStackComponent } from './photo-stack/photo-stack';

@Component({
  selector: 'app-prints',
  templateUrl: './prints.html',
  imports: [PhotoStackComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './prints.scss',
})
export class PrintsComponent implements OnInit {
  private readonly prints = inject(PrintsService);

  /**
   * Recheck which albums are finished each time the tab is opened.
   *
   * The list is a scan of the library, not a live view of it, so an album finished during this
   * session would otherwise not appear until the app was restarted. This component is rebuilt on
   * every tab switch, which makes its own creation the signal to look again.
   */
  ngOnInit(): void {
    void this.prints.refresh();
  }

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
