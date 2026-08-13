import { Injectable, computed, inject, signal } from '@angular/core';
import { AlbumPrintStore } from '../storage/review/album-print-store';
import { FinishedAlbumsService } from './finished-albums.service';
import { AlbumGroup } from '../photo';
import { AlbumPrintState } from './prints.types';

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
  private readonly finishedAlbums = inject(FinishedAlbumsService);

  private readonly states = signal<Map<string, AlbumPrintState>>(new Map());
  // A couple of random Lightroom albums, shown only while there are no real to-print albums.
  /** Albums with every photo dealt with and at least one waiting to print. */
  private readonly finished = signal<AlbumGroup[]>([]);

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
    void this.loadFinished();
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
