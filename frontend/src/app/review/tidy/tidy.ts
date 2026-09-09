import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { KeeperAlbumsService } from '../../keeper-albums.service';
import { KeeperFilingService } from '../keeper-filing.service';
import { albumSearchLinks, lightroomAlbumUrl, lightroomAssetUrl } from '../../keeper-albums';
import { PutBackComponent } from '../put-back/put-back';

/** One album's worth of tidying: the album, a way into it, and every photo to take out of it. */
interface TidyRow {
  album: string;
  /** Search links that isolate the whole set — where they can be deleted in one go. */
  albumLinks: string[];
  /** The album itself, the only place Lightroom offers "remove from this album". */
  albumUrl: string;
  photos: { name: string; url: string }[];
}

/**
 * Puts text on the clipboard, by whichever of the two ways works here.
 *
 * The modern API needs a secure context *and* a trusted user gesture, and refuses without either —
 * which is easy to hit in an embedded webview. The old selection-and-execCommand dance has neither
 * requirement and is deprecated but universally implemented, so it is the fallback rather than the
 * first choice. Nothing is claimed unless one of them actually reports success: a button that says
 * "copied" over an empty clipboard is worse than one that says nothing.
 */
async function writeToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return copyBySelection(text);
  }
}

function copyBySelection(text: string): boolean {
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  // Off-screen rather than hidden: a display:none field cannot be selected, so nothing would copy.
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.appendChild(field);
  try {
    field.select();
    // Deprecated, and kept deliberately: it is the only copy that works without a secure context or
    // a trusted gesture, which is exactly when the modern API has already refused.
    // eslint-disable-next-line sonarjs/deprecation, @typescript-eslint/no-deprecated
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    field.remove();
  }
}

/**
 * The fourth step: putting Lightroom back in order after the other three.
 *
 * <p>Both halves of the residue a one-way API leaves, in one place. Filing can add a photo to an
 * album and never take it out, so an album accumulates everything ever sent there, including
 * everything since undone — and photos can go the other way too, removed from KeeperDelete by a hand
 * that meant to delete them, which no sweep would ever notice.
 *
 * <p>A step beside Sort, Edit and Tag rather than a section in Settings, which is where it started.
 * It is work on the library, done in a session, the same as the other three — not a preference, and
 * not something to go hunting for behind a screen about storage and reminders.
 */
@Component({
  selector: 'app-tidy',
  templateUrl: './tidy.html',
  imports: [PutBackComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./tidy-card.scss', './tidy.scss'],
})
export class TidyComponent {
  private readonly albums = inject(KeeperAlbumsService);
  private readonly filing = inject(KeeperFilingService);

  /** The catalogue the links point into; without it there is nowhere to send anyone. */
  readonly catalogId = input<string | null>(null);

  private readonly rows = signal<TidyRow[]>([]);
  readonly tidyRows = computed(() => this.rows());
  readonly total = computed(() => this.rows().reduce((sum, row) => sum + row.photos.length, 0));
  /** Null until the first look, so "nothing to tidy" and "not looked yet" read differently. */
  readonly looked = signal(false);

  /** The photo whose name was just copied, so the button can say it worked. */
  readonly copied = signal<string | null>(null);

  /**
   * Puts one photo's name on the clipboard, to paste into the Lightroom app's own search.
   *
   * <p>One at a time, because that is all the app's search takes. A comma-separated list finds
   * nothing there and a space-separated pair still returns one photo — both tried against it — while
   * a single name matches exactly. So the whole set in one go, which is what the web search accepts,
   * would be a string that cannot be used where it is meant to be pasted.
   *
   * <p>Handing over the name at all is the point: the app is where this work is comfortable — the
   * album opens, a long press selects, and the selection can be taken out of the album or deleted in
   * one go — but it can be given no link to a filtered set, since it claims no route to one. So it
   * is opened by hand, and this saves the retyping.
   */
  async copyName(photo: { name: string }): Promise<void> {
    if (!(await writeToClipboard(photo.name))) {
      this.copied.set(null); // nothing copied: say nothing, the name is on screen to read
      return;
    }
    this.copied.set(photo.name);
    setTimeout(() => this.copied.update((name) => (name === photo.name ? null : name)), 2500);
  }

  constructor() {
    // An effect rather than a call, because the catalogue id is not known at construction: it is a
    // bound input, and the app is still fetching it when this screen is first built. Read reactively,
    // the look happens again the moment it arrives.
    effect(() => void this.refresh());
  }

  /**
   * Re-reads which photos are sitting in an album they have moved on from.
   *
   * The listing-backed answer, not the record-only one the tab notices use: on this screen the names
   * have to be right, and five of the six finished photos left in a real KeeperEdit had never been
   * scanned, so a record-only list named one of them and silently dropped the rest.
   *
   * Walks every filing record, so it happens when this step is opened rather than on a timer — the
   * component is built behind an `@if`, which makes opening the step exactly that moment.
   */
  private async refresh(): Promise<void> {
    const catalogId = this.catalogId();
    if (!catalogId) return;
    await this.albums.ensure();
    const stale = await this.filing.staleInAlbums();
    this.rows.set(
      [...stale]
        .map(([album, photos]) => ({ album, ...this.linksFor(catalogId, album, photos) }))
        .filter((row) => row.albumLinks.length > 0),
    );
    this.looked.set(true);
  }

  /**
   * Three ways in, because Lightroom's web app can do a different thing in each.
   *
   * <p>**The search** isolates exactly this set, and is the only view that shows the photos in
   * question and nothing else. Selecting them there offers *Verwijderen* — deleting the photograph
   * outright — but not taking it out of an album: a search is not scoped to one album as far as that
   * menu is concerned, so it has no album to remove from. Checked in the live web app.
   *
   * <p>**The album** is where "remove from this album" exists, which is what this screen is usually
   * asking for — the photo has moved on, it should stop being in KeeperEdit, and it should certainly
   * not be deleted. The cost is that it opens the whole album rather than these few.
   *
   * <p>**Per photo** is the fallback the other two need: Lightroom's index matches a photo by the
   * name it shows, and a file imported as `2021-05-24-DSC_4390.NEF` is findable by no form of its
   * name at all — the search said four photos and opened on three, with no way to tell which was
   * missing. An asset id in the path resolves whatever the file is called.
   *
   * <p>The search is split into batches because its terms ride in the URL, and a few hundred
   * filenames would make one long enough for a browser to refuse it.
   */
  private linksFor(
    catalogId: string,
    album: string,
    photos: { assetId: string; name: string }[],
  ): { albumLinks: string[]; albumUrl: string; photos: { name: string; url: string }[] } {
    const albumId = this.albums.idFor(album);
    if (!albumId) return { albumLinks: [], albumUrl: '', photos: [] };
    return {
      albumLinks: albumSearchLinks(
        catalogId,
        albumId,
        photos.map((photo) => photo.name),
      ),
      albumUrl: lightroomAlbumUrl(catalogId, albumId),
      photos: photos.map((photo) => ({
        name: photo.name,
        url: lightroomAssetUrl(catalogId, photo.assetId, photo.name),
      })),
    };
  }
}
