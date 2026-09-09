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
import { albumSearchLinks, lightroomAssetUrl } from '../../keeper-albums';
import { PutBackComponent } from '../put-back/put-back';

/** One album's worth of tidying: the album, a way into it, and every photo to take out of it. */
interface TidyRow {
  album: string;
  /** Search links that isolate the whole set, for removing them in one go. */
  albumLinks: string[];
  photos: { name: string; url: string }[];
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
   * Both ways in: one search that isolates the whole set, and one link per photo.
   *
   * The search is how the work is actually done — select all, remove, done — but it cannot be
   * trusted to reach everything. Lightroom's index matches a photo by the name it shows, and a file
   * imported as `2021-05-24-DSC_4390.NEF` is findable by no form of its name at all, so the screen
   * said four photos and the search opened on three with no way to tell which was missing. The
   * per-photo links carry the asset id in the path, which resolves whatever the file is called: use
   * the search for the bulk, then these for whatever is still listed afterwards.
   *
   * The search is split into batches because its terms ride in the URL, and a few hundred filenames
   * would make one long enough for a browser to refuse it.
   */
  private linksFor(
    catalogId: string,
    album: string,
    photos: { assetId: string; name: string }[],
  ): { albumLinks: string[]; photos: { name: string; url: string }[] } {
    const albumId = this.albums.idFor(album);
    if (!albumId) return { albumLinks: [], photos: [] };
    return {
      albumLinks: albumSearchLinks(
        catalogId,
        albumId,
        photos.map((photo) => photo.name),
      ),
      photos: photos.map((photo) => ({
        name: photo.name,
        url: lightroomAssetUrl(catalogId, photo.assetId, photo.name),
      })),
    };
  }
}
