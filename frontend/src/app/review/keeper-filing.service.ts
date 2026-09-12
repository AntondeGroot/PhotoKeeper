import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { LightroomService } from '../lightroom.service';
import { PhotoAsset } from '../lightroom-types';
import { KeeperAlbumsService } from '../keeper-albums.service';
import { albumForVerdict, belongsInPrintBin, isPrintBin } from '../keeper-albums';
import { ReviewStore } from '../storage/review/review-store';
import { KeeperFilingStore } from '../storage/review/keeper-filing-store';
import { StoredVerdict } from '../storage/photokeeper-db';
import { AssetMetaStore } from '../storage/review/asset-meta-store';
import { ReviewUndoService } from './review-undo.service';
import { CensusService } from '../stats/census.service';
import { isUnitId, splitFileName } from '../photo';

/**
 * A filename as the album search matches it: the name Lightroom shows the photo under, `DSC_4390`.
 *
 * Two things come off what the listing gives. The extension, because the search matches names rather
 * than files. And an import-date prefix: a file imported as `2021-05-24-DSC_4390.NEF` is a photograph
 * *called* DSC_4390, and searching for the prefixed form finds nothing at all — which is worse than
 * the missing rows this naming fixed, because a list of four photos and a link that opens on an empty
 * album reads as the app being wrong about the photos rather than about the query.
 */
function searchTerm(fileName: string | undefined): string | undefined {
  if (!fileName) return undefined;
  return splitFileName(fileName).name.replace(/^\d{4}-\d{2}-\d{2}-/, '');
}

/** One photo an album is holding that has moved on: enough to name it and to open it. */
export interface StalePhoto {
  assetId: string;
  /** As Lightroom shows it, `DSC_2609` — for the label. */
  name: string;
}

/** What became of one album's filings: what it has lost, and what was deleted as intended. */
export interface AlbumFilingGap {
  album: string;
  /** Filed here, and neither in the album nor deleted — taken out by hand, and only this can tell. */
  missing: string[];
  /** Filed here and since deleted in Lightroom. The tombstone is in the album; nothing to do. */
  deleted: number;
}

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
  private readonly census = inject(CensusService);

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
   * Photos an album is holding that their verdict has moved on from — album name → the photos.
   *
   * <p>The residue of a one-way API. Filing adds and can never remove, so a photo sent to edit and
   * then promoted to print stays in KeeperEdit for good as far as this app is concerned. It cannot
   * tidy that up, but it knows exactly what needs tidying and can put the user in front of it.
   *
   * <p>Asked of Lightroom rather than worked out from the records alone, which was the first shape
   * and got two things wrong, both of which hid work rather than inventing it. A photo is only in
   * the metadata store once a scan has reached it, and an unnamed one was dropped for want of
   * something to search for: of the six finished photos left behind in a real KeeperEdit, five had
   * no scanned name and the screen listed one. And a photo already taken out by hand is still on
   * record as filed, so the record-only answer went on asking for it to be removed for ever.
   *
   * <p>Costs a listing per album, so it belongs to the Tidy up screen — where someone has gone
   * specifically to do this work — rather than to anything that runs on its own.
   */
  async staleInAlbums(): Promise<Map<string, StalePhoto[]>> {
    await this.albums.ensure();
    const [stale, meta] = await Promise.all([this.staleIdsByAlbum(), this.meta.getAll()]);
    const byAlbum = new Map<string, StalePhoto[]>();
    for (const [album, assetIds] of stale) {
      const albumId = this.albums.idFor(album);
      if (!albumId) continue;
      const held = await firstValueFrom(this.svc.getAllAlbumAssets(albumId));
      this.noteContents(album, held);
      // A tombstone is not something to remove: that photo has been deleted, which is the end of it.
      const nameById = new Map(
        held
          .filter((asset) => asset.subtype !== 'deleted_image')
          .map((asset) => [asset.id, searchTerm(asset.payload?.importSource?.fileName)]),
      );
      const photos = assetIds
        .filter((id) => nameById.has(id))
        .map((id) => ({ assetId: id, name: nameById.get(id) ?? meta.get(id)?.name ?? id }));
      if (photos.length > 0) byAlbum.set(album, photos);
    }
    return byAlbum;
  }

  /**
   * Whether a photo with this verdict belongs in this album — the one rule both halves of tidying
   * ask, from opposite ends.
   *
   * <p>A print bin is asked a different question. It is not a filing any verdict implies — it is a
   * snapshot of one order — so it is not wrong merely for holding a photo the verdict map would not
   * have put there. It stops belonging once the decision behind the photo is withdrawn: the edit
   * undone, the photo rejected, or set aside as keep-but-do-not-print.
   */
  private belongsIn(album: string, verdict: StoredVerdict | undefined): boolean {
    const status = verdict?.status ?? 'backlog';
    return isPrintBin(album)
      ? belongsInPrintBin(status, verdict?.saveOnly ?? false)
      : album === albumForVerdict(status);
  }

  /** Which photos are sitting in an album their verdict has moved on from — album name → asset ids. */
  private async staleIdsByAlbum(): Promise<Map<string, string[]>> {
    const [verdicts, filed] = await Promise.all([this.reviews.getVerdicts(), this.filed.getAll()]);
    const byAlbum = new Map<string, string[]>();
    for (const [assetId, record] of filed) {
      if (isUnitId(assetId)) continue; // never a photograph; see isUnitId
      const verdict = verdicts.get(assetId);
      for (const album of record.albums) {
        if (this.belongsIn(album, verdict)) continue;
        byAlbum.set(album, [...(byAlbum.get(album) ?? []), assetId]);
      }
    }
    return byAlbum;
  }

  /**
   * What has become of everything this app filed, album by album.
   *
   * <p>The other half of the one-way API's residue, and the more damaging half. A filing is recorded
   * once and never questioned again, so a photo taken *out* of KeeperDelete in Lightroom is invisible
   * to every later sweep: it is on record as filed, so nothing will ever put it back.
   *
   * <p>The trap here is that "gone from the album" has two very different causes, and the obvious
   * reading of the listing gets it backwards. Deleting a photo in Lightroom does **not** remove it
   * from its albums — it leaves a {@link PhotoAsset.subtype} `deleted_image` tombstone in its place,
   * under a *new* id, naming the old one in `original.id`. Compared by id alone, every photo the user
   * correctly deleted therefore reads as missing: on a real KeeperDelete of 87 filings that was 85
   * "missing" photos, of which 49 were simply deleted, done, and awaiting Lightroom's purge. Offering
   * to put those back is the worst thing this could do.
   *
   * <p>Ids rather than filenames, unlike {@link staleFilings}: these go back through the API rather
   * than into a search box, and a photo with no scanned metadata can still be re-filed.
   *
   * <p>Costs one listing per album with anything on record, so it runs when asked and not on a timer.
   */
  async filingGaps(): Promise<AlbumFilingGap[]> {
    await this.albums.ensure();
    const [filed, verdicts] = await Promise.all([this.filed.getAll(), this.reviews.getVerdicts()]);
    const expected = new Map<string, string[]>();
    for (const [assetId, record] of filed) {
      // Unit ids already on record from before they were kept out of filing. Lightroom never held
      // them, so they are missing from every album for ever, and no amount of putting back would fix
      // that — they are not photographs.
      if (isUnitId(assetId)) continue;
      for (const album of record.albums) {
        // Only a photo that still belongs there can have been lost from it. One whose verdict has
        // moved on is *meant* to leave, so its absence is the tidying done — and offering to put it
        // back would undo that, while the other half of this very screen asks for it to be removed.
        if (!this.belongsIn(album, verdicts.get(assetId))) continue;
        expected.set(album, [...(expected.get(album) ?? []), assetId]);
      }
    }

    const gaps: AlbumFilingGap[] = [];
    for (const [album, assetIds] of expected) {
      const albumId = this.albums.idFor(album);
      // No album in the catalogue means nothing to compare against — not that everything is missing.
      if (!albumId) continue;
      const { present, deleted } = await this.contentsOf(albumId, album);
      const missing = assetIds.filter((assetId) => !present.has(assetId));
      const goneForGood = assetIds.filter((assetId) => deleted.has(assetId)).length;
      if (missing.length > 0 || goneForGood > 0) {
        gaps.push({ album, missing, deleted: goneForGood });
      }
    }
    return gaps;
  }

  /**
   * What an album holds, in the ids this app knows photos by.
   *
   * A tombstone stands where its photograph did, so the album has not lost anything by holding one —
   * and the id worth knowing is the one it replaced, which is the id that was filed.
   */
  private async contentsOf(
    albumId: string,
    album?: string,
  ): Promise<{ present: ReadonlySet<string>; deleted: ReadonlySet<string> }> {
    const held = await firstValueFrom(this.svc.getAllAlbumAssets(albumId));
    const present = new Set<string>();
    const deleted = new Set<string>();
    for (const asset of held) {
      present.add(asset.id);
      const was = asset.subtype === 'deleted_image' ? asset.original?.id : undefined;
      if (!was) continue;
      present.add(was);
      deleted.add(was);
    }
    if (album) this.noteContents(album, held);
    return { present, deleted };
  }

  /**
   * Tells the census what an album holds, at the one moment its contents are in hand.
   *
   * Listing an album costs a request, so the census never asks for itself: it takes what a tidy-up
   * check was fetching anyway, and a day on which nothing looked simply has no album counts. A
   * tombstone is a photograph Lightroom has deleted, so the two are counted apart — and the deleted
   * ones are named rather than tallied, because the tombstone does not last (see the census).
   *
   * Best-effort, and never awaited: recording must not slow down, or break, the check it rides on.
   */
  private noteContents(album: string, held: readonly PhotoAsset[]): void {
    // By id, not by count: Lightroom purges a tombstone after thirty days, so a photograph seen to
    // have been deleted has to be written down while it can still be named.
    const deletedIds = held
      .filter((asset) => asset.subtype === 'deleted_image')
      .map((asset) => asset.original?.id)
      .filter((id): id is string => !!id);
    void this.census
      .recordAlbum(album, { live: held.length - deletedIds.length, deletedIds })
      .catch(() => undefined);
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
      // A burst or pano card carries a verdict under its own synthetic id. That is not a photograph,
      // and asking Lightroom to file one is asking it to add an asset that does not exist. Its frames
      // carry their own verdicts and are filed on their own account.
      if (undoable.has(assetId) || isUnitId(assetId)) continue;
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
