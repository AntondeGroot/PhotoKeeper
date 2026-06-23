import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AlbumPrintStore } from '../storage/review/album-print-store';
import { ReviewStatsService } from '../review/review-stats.service';
import { LightroomService } from '../lightroom.service';
import { PhotoAsset } from '../lightroom-types';
import { AlbumGroup, Photo, splitFileName } from '../photo';
import { AlbumPrintState } from './prints.types';

/** How many random albums to surface as a preview when nothing has actually been sent to print yet. */
const DEMO_ALBUMS = 2;
/** Photos to pull per demo album (enough to fill the stack). */
const DEMO_PHOTOS = 9;

/**
 * The Prints tab's two-stage fulfilment flow on top of the to-print albums. Each album starts in "To
 * print"; "I've ordered these" moves it to "Done" (state 'ordered'), where the checkmark marks it
 * placed ('placed') — complete, so it stops showing and stops nudging. The per-album state is persisted
 * via {@link AlbumPrintStore}; the album groups come from {@link ReviewStatsService}, or — when nothing
 * has been sent to print yet — from a couple of random Lightroom albums so the page has something to show.
 */
@Injectable({ providedIn: 'root' })
export class PrintsService {
  private readonly store = inject(AlbumPrintStore);
  private readonly stats = inject(ReviewStatsService);
  private readonly svc = inject(LightroomService);

  private readonly states = signal<Map<string, AlbumPrintState>>(new Map());
  // A couple of random Lightroom albums, shown only while there are no real to-print albums.
  private readonly demo = signal<AlbumGroup[]>([]);

  constructor() {
    this.hydrate();
  }

  // The albums the tab works over: real to-print albums when there are any, else the demo preview.
  private readonly base = computed(() => {
    const real = this.stats.toPrintByAlbum();
    return real.length > 0 ? real : this.demo();
  });

  /** Albums still to export/order — no recorded state yet. */
  readonly toPrint = computed(() => this.base().filter((g) => !this.states().has(g.album)));

  /** Albums ordered and awaiting placement — the Done lane, with the "is it placed?" checkmark. */
  readonly done = computed(() =>
    this.base().filter((g) => this.states().get(g.album) === 'ordered'),
  );

  /** "I've ordered these" — move an album from To print into Done. */
  markOrdered(album: string): Promise<void> {
    return this.setState(album, 'ordered');
  }

  /** Checkmark — the prints arrived and are placed; complete the album so it stops nudging. */
  markPlaced(album: string): Promise<void> {
    return this.setState(album, 'placed');
  }

  private async setState(album: string, state: AlbumPrintState): Promise<void> {
    this.states.update((m) => new Map(m).set(album, state));
    try {
      await this.store.set(album, state);
    } catch {
      // Best-effort persistence; the in-memory state already updated the UI.
    }
  }

  // Sync wrapper keeps the async calls out of the constructor body (which sonarjs flags).
  private hydrate(): void {
    void this.load();
    void this.loadDemo();
  }

  private async load(): Promise<void> {
    try {
      const loaded = await this.store.getAll();
      // Merge *under* anything already set this session, so an action that lands before the load
      // finishes isn't clobbered (the persisted base fills in the rest).
      this.states.update((current) => new Map([...loaded, ...current]));
    } catch {
      // Leave as-is on failure — every album simply starts in "To print".
    }
  }

  // Picks a couple of random Lightroom albums and pulls a few photos from each, so the Prints page has
  // something to show before any real prints flow through. Best-effort: failure leaves the demo empty.
  private async loadDemo(): Promise<void> {
    try {
      const albums = await firstValueFrom(this.svc.getAlbums());
      const picked = shuffle(albums).slice(0, DEMO_ALBUMS);
      const groups: AlbumGroup[] = [];
      for (const album of picked) {
        const assets = await firstValueFrom(this.svc.getAllAlbumAssets(album.id));
        const photos = assets
          .filter((a) => a.subtype === 'image')
          .slice(0, DEMO_PHOTOS)
          .map((a) => assetToPhoto(a, album.name));
        if (photos.length > 0) groups.push({ album: album.name, photos });
      }
      this.demo.set(groups);
    } catch {
      // No demo data — the page falls back to its empty-state hints.
    }
  }
}

/** In-place-free Fisher–Yates shuffle, for picking random albums. */
function shuffle<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    // eslint-disable-next-line sonarjs/pseudo-random -- a demo album pick, not security-sensitive
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function assetToPhoto(asset: PhotoAsset, album: string): Photo {
  const { name, ext } = splitFileName(asset.payload?.importSource?.fileName ?? asset.id);
  return {
    id: asset.id,
    name,
    ext,
    album,
    taken: asset.payload?.captureDate ?? '',
    status: 'toPrint',
    kind: 'photo',
    starred: false,
    keepsake: false,
  };
}
