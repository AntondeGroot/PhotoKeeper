import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { LightroomService } from './lightroom.service';
import { KEEPER_EDIT_ALBUM, REQUIRED_ALBUMS, printBinsIn } from './keeper-albums';

/**
 * Which of the {@link REQUIRED_ALBUMS} the connected catalog actually has.
 *
 * One question, asked once. Two screens need the answer — the setup notice, to ask for the ones that
 * are missing, and the Edit step, to offer a link into KeeperEdit — and both asking Lightroom
 * separately would mean two calls giving the same answer, out of step with each other whenever one
 * of them was fetched at a different moment.
 */
@Injectable({ providedIn: 'root' })
export class KeeperAlbumsService {
  private readonly svc = inject(LightroomService);

  /** Album name → id, or null while the catalog has not been read (which is not "has none"). */
  private readonly idsByName = signal<ReadonlyMap<string, string> | null>(null);

  /** The in-flight (or completed) read, so a second caller joins the first rather than repeating it. */
  private pending: Promise<void> | null = null;

  /** True once the catalog has actually answered — before that, nothing can be concluded from it. */
  readonly checked = computed(() => this.idsByName() !== null);

  /** The required albums the catalog is still missing. Empty until the catalog has been read. */
  readonly missing = computed(() => {
    const have = this.idsByName();
    return have ? REQUIRED_ALBUMS.filter((album) => !have.has(album.name)) : [];
  });

  /** The id of the KeeperEdit album, or null when the catalog hasn't got one (or wasn't read). */
  readonly editAlbumId = computed(() => this.idsByName()?.get(KEEPER_EDIT_ALBUM) ?? null);

  /**
   * The print bins the catalogue has, in fill order.
   *
   * Read off the catalogue rather than configured, because the API cannot create albums: how many
   * bins there are is whatever the user has made, and making another one in Lightroom is the whole
   * of the setup for having two orders in flight at once.
   */
  readonly printBins = computed(() => printBinsIn(this.idsByName()?.keys() ?? []));

  /** The catalogue's id for a Keeper album, or null while it has not been read — or does not exist. */
  idFor(name: string): string | null {
    return this.idsByName()?.get(name) ?? null;
  }

  /** Every album the catalogue has, by id — the same read, turned round. */
  private readonly namesById = computed(() => {
    const byName = this.idsByName();
    return byName ? new Map([...byName].map(([name, id]) => [id, name])) : null;
  });

  /**
   * What an album is called, for a screen that has only its id.
   *
   * The read behind this fetches the whole catalogue, not only the Keeper albums, so the names are
   * already in hand — which is what lets a photograph be named by its album without a request of
   * its own.
   */
  nameFor(albumId: string): string | null {
    return this.namesById()?.get(albumId) ?? null;
  }

  /** Reads the catalog once per session. Repeated calls join the first read instead of re-asking. */
  ensure(): Promise<void> {
    this.pending ??= this.load();
    return this.pending;
  }

  /** Asks again — for after the user has gone off to Lightroom to create the albums. */
  refresh(): Promise<void> {
    this.pending = this.load();
    return this.pending;
  }

  private async load(): Promise<void> {
    try {
      const albums = await firstValueFrom(this.svc.getAlbums());
      this.idsByName.set(new Map(albums.map((album) => [album.name, album.id])));
    } catch {
      // Couldn't reach the catalog: stay unread rather than claim the albums are missing, and drop
      // the cached attempt so the next caller genuinely retries.
      this.pending = null;
    }
  }
}
