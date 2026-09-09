import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { AlbumFilingGap, KeeperFilingService } from '../keeper-filing.service';

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
  styleUrl: '../tidy/tidy-card.scss',
})
export class PutBackComponent {
  private readonly filing = inject(KeeperFilingService);

  readonly checking = signal(false);
  /** Null until a check has been run, so "nothing lost" and "not looked yet" read differently. */
  readonly rows = signal<AlbumFilingGap[] | null>(null);
  readonly failed = signal(false);
  /** What the last put-back managed, so the result is stated rather than implied by a list vanishing. */
  readonly restored = signal<{ filed: number; lost: number } | null>(null);

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
   * Files every lost photo back into its album.
   *
   * A photo that cannot go back is one Lightroom no longer has — genuinely deleted rather than
   * removed from a list — so the count of those is worth saying out loud: it is the difference
   * between "put back" and "already gone", and only the user can tell whether that is a surprise.
   */
  async putBack(): Promise<void> {
    if (this.checking()) return;
    this.checking.set(true);
    let filed = 0;
    let asked = 0;
    try {
      for (const row of this.lost()) {
        asked += row.missing.length;
        filed += await this.filing.fileSet(row.album, row.missing);
      }
      this.restored.set({ filed, lost: asked - filed });
      this.rows.set((this.rows() ?? []).map((row) => ({ ...row, missing: [] })));
    } catch {
      this.failed.set(true);
    } finally {
      this.checking.set(false);
    }
  }
}
