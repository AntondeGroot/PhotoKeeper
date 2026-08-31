import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { LightroomService } from './lightroom.service';
import { KEEPER_EDIT_ALBUM, REQUIRED_ALBUMS } from './keeper-albums';

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
