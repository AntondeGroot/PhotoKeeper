import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { LightroomService } from '../lightroom.service';
import { KeeperAlbumsService } from '../keeper-albums.service';
import { albumForVerdict, isPrintBin } from '../keeper-albums';
import { ReviewStore } from '../storage/review/review-store';
import { KeeperFilingStore } from '../storage/review/keeper-filing-store';
import { AssetMetaStore } from '../storage/review/asset-meta-store';
import { ReviewUndoService } from './review-undo.service';

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
  private readonly meta = inject(AssetMetaStore);
  private readonly undoStack = inject(ReviewUndoService);

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

  /**
   * Files a chosen set into a named album, now, and says how many landed.
   *
   * Separate from {@link sweep} because it answers a different question. The sweep files what a
   * verdict implies, whenever it gets round to it; this files a set the user has just confirmed,
   * into an album the user has just been shown — the print set, which no single verdict implies and
   * which only exists once the whole album is decided and its exceptions set aside.
   *
   * Returns 0 when the album is not in the catalogue, rather than throwing: the caller has a better
   * place to say "you have not made that album yet" than an exception does.
   */
  async fileSet(album: string, assetIds: readonly string[]): Promise<number> {
    if (assetIds.length === 0) return 0;
    await this.albums.ensure();
    const albumId = this.albums.idFor(album);
    if (!albumId) return 0;
    return this.fileInto(albumId, album, [...assetIds]);
  }

  /**
   * Photos sitting in an album their verdict has moved on from — album name → their filenames.
   *
   * The residue of a one-way API. Filing adds and can never remove, so a photo sent to edit and then
   * promoted to print stays in KeeperEdit for good as far as this app is concerned. It cannot tidy
   * that up, but it knows exactly what needs tidying, and a search link can put the user in front of
   * precisely those photos.
   *
   * Filenames rather than ids, because the search matches on names — which is also why a photo whose
   * metadata has not been scanned is left out: without a name there is nothing to search for.
   */
  async staleFilings(): Promise<Map<string, string[]>> {
    const [verdicts, filed, meta] = await Promise.all([
      this.reviews.getVerdicts(),
      this.filed.getAll(),
      this.meta.getAll(),
    ]);
    const byAlbum = new Map<string, string[]>();
    for (const [assetId, record] of filed) {
      const belongs = albumForVerdict(verdicts.get(assetId)?.status ?? 'backlog');
      const name = meta.get(assetId)?.name;
      if (!name) continue;
      for (const album of record.albums) {
        if (album === belongs) continue;
        // A print bin is not a filing a verdict implies — it is a record of one order the user sent
        // deliberately. Nothing has "moved on" from it, so it is never something to tidy away.
        if (isPrintBin(album)) continue;
        byAlbum.set(album, [...(byAlbum.get(album) ?? []), name]);
      }
    }
    return byAlbum;
  }

  /**
   * What each album is still owed: decided photos not already filed *there*, and not still undoable.
   *
   * <p>A decision the user can still take back is deliberately held out. Album membership cannot be
   * removed once written, so filing one of those would make undo a half-truth — the app would forget
   * the verdict and Lightroom would keep it for good. The undo stack is in memory, so it is empty by
   * the next app start and the sweep that runs on loading a day files everything it was holding.
   */
  private async outstanding(): Promise<Map<string, string[]>> {
    const [verdicts, filed] = await Promise.all([this.reviews.getVerdicts(), this.filed.getAll()]);
    const undoable = this.undoStack.heldAssetIds();
    const byAlbum = new Map<string, string[]>();
    for (const [assetId, verdict] of verdicts) {
      if (undoable.has(assetId)) continue;
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
