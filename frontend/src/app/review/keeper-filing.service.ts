import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { LightroomService } from '../lightroom.service';
import { KeeperAlbumsService } from '../keeper-albums.service';
import { albumForVerdict } from '../keeper-albums';
import { ReviewStore } from '../storage/review/review-store';
import { KeeperFilingStore } from '../storage/review/keeper-filing-store';

/** How many assets go into one write. Adobe takes a batch; a whole backlog in one call is rude. */
const BATCH = 50;

/** How long after the last verdict to write back — long enough that a run of swipes is one sweep. */
const SWEEP_DEBOUNCE_MS = 5_000;

/**
 * Writes decided photos back into the Keeper albums.
 *
 * <p>This is where an evening's sorting stops being private to one phone. Album membership is the
 * only durable write the partner scope allows — ratings and flags answer 403, and album creation is
 * blocked — so it is also the whole of what can be written. That turns out to be enough: the point
 * of sorting is that KeeperDelete afterwards holds the photos to delete.
 *
 * <p>Filing runs as a sweep over everything outstanding rather than as a side effect of each swipe.
 * A per-swipe write would be a network call in the middle of the one interaction that has to stay
 * instant, and it would have no answer for the verdicts decided while offline, or before the albums
 * existed, or during the weeks this feature did not exist. A sweep has the same answer for all of
 * them, and it is the same answer as for the ordinary case.
 *
 * <p>Nothing is recorded as filed unless the write returned, so a failure costs a repeat rather than
 * a photograph Lightroom never heard about that the app believes it has dealt with. Re-filing one
 * that is already there is safe but not free: Lightroom answers 403 for it rather than shrugging, so
 * the backend reads that particular refusal as "already where you wanted it" — see
 * `LightroomService.addAssetsToAlbum`, which is also why a failed batch is retried one at a time.
 */
@Injectable({ providedIn: 'root' })
export class KeeperFilingService {
  private readonly svc = inject(LightroomService);
  private readonly albums = inject(KeeperAlbumsService);
  private readonly reviews = inject(ReviewStore);
  private readonly filed = inject(KeeperFilingStore);

  /** Photos filed in the last sweep, for the settings line that says what happened. */
  readonly lastFiled = signal(0);
  /** Photos waiting on an album the catalogue does not have yet. */
  readonly blockedByMissingAlbum = signal(0);
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Sweeps shortly after the last verdict, rather than on each one.
   *
   * Debounced because a session is a run of decisions seconds apart, and a write per swipe would put
   * a network call in the middle of the one interaction that has to stay instant — for no gain, since
   * the sweep files the whole backlog whenever it does run.
   */
  scheduleSweep(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.sweep(), SWEEP_DEBOUNCE_MS);
  }

  /** Clears any pending sweep (call on teardown). */
  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /**
   * Files everything decided but not yet filed. Safe to call often; a second call while one is in
   * flight does nothing rather than sending the same batch twice.
   */
  async sweep(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.albums.ensure();
      const outstanding = await this.outstanding();
      let filed = 0;
      let blocked = 0;
      for (const [album, assetIds] of outstanding) {
        const albumId = this.albums.idFor(album);
        if (!albumId) {
          blocked += assetIds.length; // the user has not made this album yet; the notice asks them to
          continue;
        }
        filed += await this.fileInto(albumId, album, assetIds);
      }
      this.lastFiled.set(filed);
      this.blockedByMissingAlbum.set(blocked);
    } catch {
      // Best-effort: a sweep that fails leaves everything outstanding, and the next one retries it.
    } finally {
      this.running = false;
    }
  }

  /** What each album is still owed: decided photos not already filed *there*. */
  private async outstanding(): Promise<Map<string, string[]>> {
    const [verdicts, filed] = await Promise.all([this.reviews.getVerdicts(), this.filed.getAll()]);
    const byAlbum = new Map<string, string[]>();
    for (const [assetId, verdict] of verdicts) {
      const album = albumForVerdict(verdict.status);
      // Compared by album, not by "has it been filed at all": a photo that went to KeeperEdit and is
      // later sent to print has to reach KeeperPrint too.
      if (!album || filed.get(assetId)?.albums.includes(album)) continue;
      byAlbum.set(album, [...(byAlbum.get(album) ?? []), assetId]);
    }
    return byAlbum;
  }

  /** Files one album's batches, recording only what actually landed. */
  private async fileInto(albumId: string, album: string, assetIds: string[]): Promise<number> {
    let filed = 0;
    for (let i = 0; i < assetIds.length; i += BATCH) {
      filed += await this.fileBatch(albumId, album, assetIds.slice(i, i + BATCH));
    }
    return filed;
  }

  /**
   * Files one batch, and falls back to one call per photo when the batch is refused.
   *
   * Lightroom rejects a whole write for one bad member — a stacked asset answers 403
   * `AddStackToAlbumRedirectError`, because a stack has to go in through a different endpoint. Sent
   * as a batch that means a single stacked photo fails the other forty-nine with it, and since
   * nothing is then recorded, the next sweep rebuilds the identical batch and fails identically.
   * One unfilable photo would block its album permanently.
   *
   * So a refused batch is retried one at a time: the photos that can be filed are, the ones that
   * cannot stay outstanding, and the cost of splitting is paid only when something has gone wrong.
   */
  private async fileBatch(albumId: string, album: string, batch: string[]): Promise<number> {
    try {
      await firstValueFrom(this.svc.addToAlbum(albumId, batch));
      await this.filed.record(batch, album);
      return batch.length;
    } catch {
      if (batch.length === 1) return 0; // already alone: this one genuinely cannot be filed
    }

    let filed = 0;
    for (const assetId of batch) {
      filed += await this.fileBatch(albumId, album, [assetId]);
    }
    return filed;
  }
}
