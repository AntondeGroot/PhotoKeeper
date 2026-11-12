import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { AlbumFilingGap, FilingOutcome, KeeperFilingService } from '../keeper-filing.service';

/** What the last put-back managed. A photo Lightroom refused is not one it no longer has. */
interface PutBackResult {
  filed: number;
  gone: number;
  refused: number;
  /** Held on the phone because KeeperEdit is at its limit; the sweep sends them as room opens. */
  waiting: number;
  /** Whether the connection went before everything had been tried. */
  stopped: boolean;
}

/**
 * "These photos should be in a Keeper album and are not — put them back."
 *
 * <p>The mirror of the list above it on this screen, and the more damaging of the two. Removing a photo from
 * KeeperDelete in Lightroom does not delete the photograph, and it is an easy thing to do by
 * accident while meaning to; but the app records a filing once and never questions it, so no later
 * sweep would ever notice. The photos were simply lost — still in the catalogue, no longer on any
 * list of things to delete.
 *
 * <p>Asked for rather than watched: it costs a listing per album, which is not something to do
 * behind a screen nobody is looking at.
 */
@Component({
  selector: 'app-put-back',
  templateUrl: './put-back.html',
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../tidy/tidy-card.scss',
})
export class PutBackComponent {
  private readonly filing = inject(KeeperFilingService);

  readonly checking = signal(false);
  /** Null until a check has been run, so "nothing lost" and "not looked yet" read differently. */
  readonly rows = signal<AlbumFilingGap[] | null>(null);
  readonly failed = signal(false);
  /** What the last put-back managed, so the result is stated rather than implied by a list vanishing. */
  readonly restored = signal<PutBackResult | null>(null);
  /** How many of the current put-back have been dealt with, so a long one visibly moves. */
  readonly progress = signal(0);
  /** The size of the current put-back, fixed at the start: {@link total} shrinks as albums finish. */
  readonly runTotal = signal(0);

  /** Albums that have actually lost something — the only ones there is anything to do about. */
  readonly lost = computed(() => (this.rows() ?? []).filter((row) => row.missing.length > 0));
  readonly total = computed(() => this.lost().reduce((sum, row) => sum + row.missing.length, 0));

  /**
   * Photos filed and since deleted in Lightroom. Said out loud because it is the *good* outcome and
   * it is most of the number: without it a check that found 36 real losses among 49 deletions would
   * look like it had lost track of 85 photographs.
   */
  readonly deleted = computed(() => (this.rows() ?? []).reduce((sum, row) => sum + row.deleted, 0));

  /** Whether the only thing left to offer is another look — nothing lost, or nothing looked at. */
  readonly nothingToPutBack = computed(() => this.lost().length === 0);

  async check(): Promise<void> {
    if (this.checking()) return;
    this.checking.set(true);
    this.failed.set(false);
    this.restored.set(null);
    try {
      this.rows.set(await this.filing.filingGaps());
    } catch {
      this.failed.set(true);
      this.rows.set(null);
    } finally {
      this.checking.set(false);
    }
  }

  /**
   * Files every lost photo back into its album, stopping if the connection goes.
   *
   * What a stopped run did not reach stays on the screen, and the button carries on from there. What
   * it did reach is already written down, so nothing is repeated.
   */
  async putBack(): Promise<void> {
    if (this.checking()) return;
    this.checking.set(true);
    this.progress.set(0);
    this.runTotal.set(this.total());
    try {
      this.restored.set(await this.putBackAlbums());
    } catch {
      this.failed.set(true);
      this.rows.set(null);
    } finally {
      this.checking.set(false);
    }
  }

  private async putBackAlbums(): Promise<PutBackResult> {
    const result: PutBackResult = { filed: 0, gone: 0, refused: 0, waiting: 0, stopped: false };
    for (const row of this.lost()) {
      const before = this.progress();
      const outcome = await this.filing.putBack(row.album, row.missing, (settled) =>
        this.progress.set(before + settled),
      );
      result.filed += outcome.filed;
      result.gone += outcome.gone;
      result.refused += outcome.refused;
      result.waiting += outcome.waiting ?? 0;
      this.settleRow(row.album, outcome);
      if (outcome.untried.length > 0) return { ...result, stopped: true };
    }
    return result;
  }

  /** Leaves on the row only what was not reached. What proved gone is said once, in the result. */
  private settleRow(album: string, outcome: FilingOutcome): void {
    this.rows.update((rows) =>
      (rows ?? []).map((row) => (row.album === album ? { ...row, missing: outcome.untried } : row)),
    );
  }
}
