import { Injectable, computed, inject, signal } from '@angular/core';
import { AlbumPrintStore } from '../storage/review/album-print-store';
import { PrintBinStore } from '../storage/review/print-bin-store';
import { FinishedAlbumsService } from './finished-albums.service';
import { KeeperAlbumsService } from '../keeper-albums.service';
import { KeeperFilingService } from '../review/keeper-filing.service';
import { AlbumGroup } from '../photo';
import { AlbumPrintState, PrintBin, firstFreeBin, printsIn } from './prints.types';
import { Photo } from '../photo';
import { ReviewStore } from '../storage/review/review-store';

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
  private readonly bins = inject(PrintBinStore);
  private readonly finishedAlbums = inject(FinishedAlbumsService);
  private readonly keeperAlbums = inject(KeeperAlbumsService);
  private readonly filing = inject(KeeperFilingService);
  private readonly reviews = inject(ReviewStore);

  private readonly states = signal<Map<string, AlbumPrintState>>(new Map());
  // A couple of random Lightroom albums, shown only while there are no real to-print albums.
  /** Albums with every photo dealt with and at least one waiting to print. */
  private readonly finished = signal<AlbumGroup[]>([]);
  /** Bin album name → the order sitting in it. Absent from the map means the bin is empty. */
  private readonly occupied = signal<ReadonlyMap<string, PrintBin>>(new Map());
  /** True while a set is being written to Lightroom, so the button cannot be pressed twice. */
  readonly sending = signal(false);

  constructor() {
    this.hydrate();
  }

  /**
   * The albums the tab works over: those genuinely finished and waiting to be printed.
   *
   * No placeholder. It used to fall back to a couple of *random* Lightroom albums whenever nothing
   * had reached print yet — so the page showed albums that had never been reviewed, indistinguishable
   * from real work. An empty Prints tab is the honest answer.
   */
  private readonly base = computed(() => this.finished());

  /** Albums whose prints have not been ordered yet — the first lane. */
  readonly toPrint = computed(() => this.base().filter((g) => !this.states().has(g.album)));

  /** Ordered, and waiting for the prints to arrive. */
  readonly ordered = computed(() =>
    this.base().filter((g) => this.states().get(g.album) === 'ordered'),
  );

  /** Done: nothing further to do with this album, whether or not anything was printed. */
  readonly done = computed(() => this.base().filter((g) => this.states().get(g.album) === 'done'));

  /**
   * Flips one photo between "print it" and "just save it" — in the albums on screen and on disk.
   *
   * The choice belongs to the photo, not the album, so it is stored on the verdict: it then survives
   * the album being ordered, re-scanned, or looked at again months later.
   */
  async toggleSaveOnly(photo: Photo): Promise<void> {
    const saveOnly = !photo.saveOnly;
    this.finished.update((groups) =>
      groups.map((group) => ({
        ...group,
        photos: group.photos.map((p) => (p.id === photo.id ? { ...p, saveOnly } : p)),
      })),
    );
    try {
      await this.reviews.setSaveOnly(photo.id, saveOnly);
    } catch {
      // Best-effort persistence; the grid already shows the choice.
    }
  }

  /** The catalogue's print bins, in fill order, with what each one holds. */
  readonly binState = computed(() =>
    this.keeperAlbums.printBins().map((bin) => ({ bin, holds: this.occupied().get(bin) ?? null })),
  );

  /** The bin the next order would go into, or null when every bin is still holding one. */
  readonly nextBin = computed(() => firstFreeBin(this.keeperAlbums.printBins(), this.occupied()));

  /**
   * Whether the catalogue has been read, so an absence of free bins means something.
   *
   * Without it "no free bin" and "we have not looked yet" are the same value, and the tab told
   * people to go and empty an album before it had any idea what albums they had.
   */
  readonly binsKnown = this.keeperAlbums.checked;

  /**
   * What is in each occupied bin, phrased for the notice shown when there is nowhere to send.
   *
   * Named rather than counted, because "every print album is full" tells you nothing you can act on:
   * the album you have to go and empty is the one being named here.
   */
  readonly binsInUse = computed(() =>
    [...this.occupied().entries()].map(([bin, held]) => ({
      bin,
      album: held.album,
      photos: held.photos,
    })),
  );

  /** The bin holding this album's order, or null when it has not been sent yet. */
  binHolding(album: string): string | null {
    for (const [bin, held] of this.occupied()) {
      if (held.album === album) return bin;
    }
    return null;
  }

  /**
   * Writes an album's chosen photos into the next free bin.
   *
   * The one moment the print set is knowable, and so the only safe moment to write it: a photo
   * cannot be taken out of a Lightroom album afterwards. Nothing is recorded as sent unless the
   * write returned something, so a failed order can simply be sent again.
   */
  async sendToBin(group: AlbumGroup): Promise<void> {
    const bin = this.nextBin();
    const photos = printsIn(group);
    if (!bin || photos.length === 0 || this.sending()) return;

    this.sending.set(true);
    try {
      const filed = await this.filing.fileSet(
        bin,
        photos.map((photo) => photo.id),
      );
      if (filed === 0) return; // the album is not in the catalogue, or Lightroom refused every photo
      const contents: PrintBin = { album: group.album, photos: filed, sentAt: Date.now() };
      this.occupied.update((m) => new Map(m).set(bin, contents));
      await this.bins.occupy(bin, contents).catch(() => undefined);
    } finally {
      this.sending.set(false);
    }
  }

  /**
   * The user has emptied a bin in Lightroom, so it can take the next order.
   *
   * A step the app cannot do or verify for itself — the API neither removes photos from an album nor
   * offers a way to be sure one is empty — so this is taken on the user's word.
   */
  async freeBin(bin: string): Promise<void> {
    this.occupied.update((m) => {
      const next = new Map(m);
      next.delete(bin);
      return next;
    });
    await this.bins.free(bin).catch(() => undefined);
  }

  /**
   * "I've ordered these" — the order has been placed with whoever is printing it.
   *
   * Moves nothing. The photos are already in a print album and stay there; this records that they
   * have been sent off, which is a fact only the user has.
   */
  markOrdered(album: string): Promise<void> {
    return this.setState(album, 'ordered');
  }

  /**
   * The album needs nothing further — the prints arrived, or there were never any to order.
   *
   * One state for both, because they are the same fact about the album. Which of them happened is
   * said by the button the user pressed, not by anything stored.
   */
  markDone(album: string): Promise<void> {
    return this.setState(album, 'done');
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
    void this.loadFinished();
    void this.loadBins();
    // The bins are Lightroom albums, so the catalogue has to have been read before this tab can say
    // anything about them. Every other caller of this reads it for its own reasons and might not.
    void this.keeperAlbums.ensure();
  }

  private async loadBins(): Promise<void> {
    try {
      this.occupied.set(await this.bins.getAll());
    } catch {
      // Unreadable: every bin simply looks empty, and sending again is harmless — Lightroom treats
      // a photo already in the album as already there.
    }
  }

  /** Recomputes which albums are finished. Cheap enough to redo whenever the tab is opened. */
  async refresh(): Promise<void> {
    await this.loadFinished();
  }

  private async loadFinished(): Promise<void> {
    try {
      this.finished.set(await this.finishedAlbums.load());
    } catch {
      // Best-effort: an unreadable library leaves the tab empty rather than showing guesses.
    }
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
}
