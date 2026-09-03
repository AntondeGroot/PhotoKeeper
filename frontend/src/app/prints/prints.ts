import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { PrintsService } from './prints.service';
import { PhotoStackComponent } from './photo-stack/photo-stack';
import { PrintPickerComponent } from './print-picker/print-picker';
import { printsIn } from './prints.types';
import { AlbumGroup, Photo } from '../photo';

@Component({
  selector: 'app-prints',
  templateUrl: './prints.html',
  imports: [PhotoStackComponent, PrintPickerComponent],
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

  /** The album whose prints are being chosen, if any — it takes over the tab while it is open. */
  private readonly choosing = signal<string | null>(null);

  /**
   * That album as it stands now, read back out of the lane rather than kept as a copy — the picker
   * has to redraw as photos are set aside, and a snapshot would freeze on the state it opened with.
   */
  readonly choosingAlbum = computed(
    () => this.toPrint().find((group) => group.album === this.choosing()) ?? null,
  );

  /** The photos of `group` that will actually be ordered. */
  chosen(group: AlbumGroup): Photo[] {
    return printsIn(group);
  }

  /** Open the print picker for an album, or come back from it. */
  choose(album: string | null): void {
    this.choosing.set(album);
  }

  /** A photo was tapped in the picker: flip it between printing and just being kept. */
  toggleSaveOnly(photo: Photo): void {
    void this.prints.toggleSaveOnly(photo);
  }

  /**
   * The album's one action, which is two things depending on what was chosen.
   *
   * With prints chosen it means "ordered" and the album moves to Done. With every photo set aside
   * there is nothing to order, so the album is completed outright — otherwise an album you decided
   * not to print anything from would sit in the lane for good, since only ordering ever clears it.
   */
  settle(group: AlbumGroup): void {
    if (this.chosen(group).length > 0) void this.prints.markOrdered(group.album);
    else void this.prints.markPlaced(group.album);
  }

  /** Checkmark — the prints are placed; complete the album. */
  markPlaced(album: string): void {
    void this.prints.markPlaced(album);
  }
}
