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

  /** The three stages of the journey: not ordered, ordered and waiting, arrived. */
  readonly toPrint = this.prints.toPrint;
  readonly ordered = this.prints.ordered;
  readonly done = this.prints.done;
  /** The bins and what each holds, the next free one, and whether a write is in flight. */
  readonly binState = this.prints.binState;
  readonly nextBin = this.prints.nextBin;
  readonly binsKnown = this.prints.binsKnown;
  readonly binsInUse = this.prints.binsInUse;
  readonly sending = this.prints.sending;
  /** Only the bins actually holding an order — the ones the user can act on. */
  readonly occupiedBins = computed(() => this.binState().filter((slot) => slot.holds !== null));

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

  /** The bin this album's photos were sent to, or null while they have not been sent. */
  sentTo(album: string): string | null {
    return this.prints.binHolding(album);
  }

  /** Put the chosen photos in a Lightroom album, so there is something to export. */
  send(group: AlbumGroup): void {
    void this.prints.sendToBin(group);
  }

  /** The user has emptied a bin in Lightroom — it can hold the next order. */
  freeBin(bin: string): void {
    void this.prints.freeBin(bin);
  }

  /** A photo was tapped in the picker: flip it between printing and just being kept. */
  toggleSaveOnly(photo: Photo): void {
    void this.prints.toggleSaveOnly(photo);
  }

  /** "I've ordered these" — recorded, and nothing in Lightroom moves. */
  markOrdered(album: string): void {
    void this.prints.markOrdered(album);
  }

  /** "I've received these" — the prints arrived, so the album is done. */
  markReceived(album: string): void {
    void this.prints.markDone(album);
  }

  /**
   * Completes an album nothing is being printed from.
   *
   * Every photo set aside as a keepsake means there is no order to place and none to receive, so the
   * two middle steps have nothing to record — and the album is no less finished for it. Without this
   * it would sit in the first lane for good, since ordering is the only other way out.
   *
   * The same end state as receiving prints, reached by a different button: which of the two happened
   * is what the user pressed, not something worth storing.
   */
  completeUnprinted(album: string): void {
    void this.prints.markDone(album);
  }
}
