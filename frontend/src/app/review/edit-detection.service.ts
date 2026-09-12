import { Injectable, computed, inject, signal } from '@angular/core';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import { LightroomService } from '../lightroom.service';
import { KeeperAlbumsService } from '../keeper-albums.service';
import { KEEPER_EDIT_ALBUM } from '../keeper-albums';
import { ImageHasher } from '../detection/detectors/image-hasher';
import { EditBaselineStore } from '../storage/review/edit-baseline-store';
import { HashStore } from '../storage/detection/hash-store';
import { AlbumManifestStore } from '../storage/detection/album-manifest-store';
import { AssetMetaStore } from '../storage/review/asset-meta-store';
import { GroupStore } from '../storage/detection/group-store';
import { PhotoMergeStore } from '../storage/review/photo-merge-store';
import { ReviewStore } from '../storage/review/review-store';
import { ReviewFeedService } from './review-feed.service';
import { DailyProgressService } from './daily-progress.service';
import { EditBaseline, EditVerdict, edited, stampMoved, verdictFor } from './edit-detection';
import { PhotoAsset } from '../lightroom-types';
import { MergedPhoto, findMerges } from './merged-photo';

/** One row of the check's result: the verdict, plus enough to show it. */
export interface EditFinding extends EditVerdict {
  name: string;
}

/** The edit queue as both buttons need it: what is waiting, and what is known about each photo. */
interface EditQueue {
  queued: PhotoAsset[];
  baselines: ReadonlyMap<string, EditBaseline>;
  name: (asset: PhotoAsset) => string;
}

/** The hash is computed from the smallest rendition; the downscale throws the rest away anyway. */
const HASH_RENDITION = '640';

/**
 * Which photos in the edit queue have actually been edited.
 *
 * <p>Answering it costs a rendition download per photo, so it is not something to do on a timer —
 * it runs when asked. The cheap half runs first: one listing of the KeeperEdit album gives every
 * photo's current revision stamp for a single request, and only the photos whose stamp has moved are
 * worth downloading. A probe against the live API established that album membership does not move
 * the stamp, so filing into KeeperEdit cannot make an untouched photo look edited.
 *
 * <p>Scoped to KeeperEdit rather than to the deck. The deck is a day's sample; the album is every
 * photo waiting to be edited, which is what "check my edits" means.
 */
@Injectable({ providedIn: 'root' })
export class EditDetectionService {
  private readonly svc = inject(LightroomService);
  private readonly albums = inject(KeeperAlbumsService);
  private readonly baselines = inject(EditBaselineStore);
  private readonly hashes = inject(HashStore);
  private readonly manifests = inject(AlbumManifestStore);
  private readonly meta = inject(AssetMetaStore);
  private readonly groups = inject(GroupStore);
  private readonly mergeRecords = inject(PhotoMergeStore);
  private readonly reviews = inject(ReviewStore);
  private readonly hasher = inject(ImageHasher);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly feed = inject(ReviewFeedService);
  private readonly progress = inject(DailyProgressService);

  /** What the last check found, newest run replacing the last. Null until one has been run. */
  readonly findings = signal<EditFinding[] | null>(null);

  /**
   * Photographs Lightroom has merged out of frames that were sent off to be edited.
   *
   * Held apart from the findings because it is a different question with a different answer. A
   * finding says a photograph changed; this says several photographs became one, and what settles it
   * is not "this one is done" but "these are finished, and here is what came of them".
   */
  readonly merges = signal<MergedPhoto[]>([]);
  readonly checking = signal(false);
  /** True when the album could not be read at all — the panel says so rather than "nothing found". */
  readonly failed = signal(false);

  /** The photos worth acting on: the ones whose picture changed. */
  readonly editedFindings = computed(() => edited(this.findings() ?? []));

  /**
   * What the panel puts on screen, and so what is worth fetching a picture for.
   *
   * The check offers only the photos whose picture changed — one whose revision moved without the
   * photograph changing would print the version that was already there. A list asked for by hand
   * offers everything still waiting, because the point of asking is that the app's answer is not the
   * one wanted.
   */
  readonly shownFindings = computed(() =>
    this.picking() ? (this.findings() ?? []) : this.editedFindings(),
  );

  /** Whether the panel is on screen. */
  readonly panelOpen = signal(false);

  /**
   * A small preview per listed photo, so a row is a photograph rather than a filename.
   *
   * Nobody knows which shot `DSC_4471.NEF` is. The 640px rendition is the one the check already
   * downloads to hash, so for those photos the picture costs nothing extra; the rest are fetched
   * when the list is published. Held here for the life of the panel and released when it closes —
   * these are one-off object URLs, not part of the review deck's cache.
   */
  readonly thumbnails = signal<ReadonlyMap<string, SafeUrl>>(new Map());
  private objectUrls: string[] = [];
  /**
   * Whether the list on screen was asked for by hand rather than worked out.
   *
   * The check can only answer for photos it has an earlier version of, and it will never answer for
   * a photo sent to edit by mistake — nothing about that one has changed, and nothing should have.
   * So the queue can also simply be listed, and the person who did the editing says which are done.
   */
  readonly picking = signal(false);

  closePanel(): void {
    this.panelOpen.set(false);
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls = [];
    this.thumbnails.set(new Map());
  }

  /**
   * Records what a photo looks like now, so a later edit can be spotted.
   *
   * Called when a photo is sent to edit, and again when the user says an edit is not finished — the
   * two are the same fact ("this is the version I am starting from"), so they are the same write.
   *
   * Copied out of the detection stores rather than read from them at check time: those are rewritten
   * by every re-scan, so a scan running after an edit would carry the baseline onto the edited photo
   * and the edit would vanish.
   */
  async captureBaseline(
    assetId: string,
    seen?: { hash?: string; updated?: string },
  ): Promise<void> {
    try {
      // Hashed here when the scan has not already done it, which for an ordinary photograph it has
      // not: the scan hashes burst and pano *candidates* only, so a lone photo has no hash to copy.
      // Taking the store's answer as final is what broke this — the baseline went out without a
      // hash, and a baseline with no hash can only ever answer 'unknown', so every real edit was
      // invisible. One 640px rendition per photo sent to edit is what the answer costs.
      const hash = seen?.hash ?? (await this.hashes.get(assetId)) ?? (await this.hashNow(assetId));
      const updated = seen?.updated ?? (await this.stampFromManifest(assetId));
      await this.baselines.set(assetId, { hash, updated, at: Date.now() });
    } catch {
      // Best-effort: without a baseline the check reports 'unknown' rather than misleading anyone.
    }
  }

  /** Forgets the baseline of a photo that has left the queue. */
  async forget(assetId: string): Promise<void> {
    await this.baselines.remove(assetId).catch(() => undefined);
  }

  /**
   * Runs the check over everything in KeeperEdit and publishes what it found.
   *
   * Never throws: it is a button, and a failure has to leave the panel saying so rather than
   * rejecting into a caller that has nowhere to put the error.
   */
  async check(): Promise<void> {
    await this.publish(false, (queue) => this.runCheck(queue));
  }

  /**
   * "I know which ones I edited" — every photo still waiting, listed for the user to pick from.
   *
   * The check answers a narrower question than it looks like it does: it can only speak for photos
   * it holds an earlier version of, and it will never speak for one sent to edit by a mis-tap, since
   * nothing about that photo has changed. Listing the queue costs one request and no downloads, and
   * the person who did the editing already knows the answer.
   */
  async listQueue(): Promise<void> {
    await this.publish(true, (queue) => Promise.resolve(this.listRows(queue)));
  }

  /** The shared shape of both buttons: read the queue, build rows from it, open the panel. */
  private async publish(
    picking: boolean,
    build: (queue: EditQueue) => Promise<EditFinding[]>,
  ): Promise<void> {
    if (this.checking()) return;
    this.checking.set(true);
    this.failed.set(false);
    this.picking.set(picking);
    try {
      this.findings.set(await build(await this.readQueue()));
      this.merges.set(await this.findMerges());
      // Only what the panel will actually show. Fetching a picture for the rest would undo the cheap
      // pass — whose whole point is that a photo whose revision never moved is never downloaded.
      void this.loadThumbnails(this.shownFindings().map((finding) => finding.assetId));
    } catch {
      this.failed.set(true);
      this.findings.set([]);
      this.merges.set([]);
    } finally {
      this.checking.set(false);
      this.panelOpen.set(true);
    }
  }

  /** Everything still waiting to be edited, with what is known about each. */
  private async readQueue(): Promise<EditQueue> {
    await this.albums.ensure();
    const albumId = this.albums.idFor(KEEPER_EDIT_ALBUM);
    if (!albumId) throw new Error(`no ${KEEPER_EDIT_ALBUM} album`);

    const [assets, baselines, meta, verdicts] = await Promise.all([
      firstValueFrom(this.svc.getAllAlbumAssets(albumId)),
      this.baselines.getAll(),
      this.meta.getAll(),
      this.reviews.getVerdicts(),
    ]);

    // The album is not the queue, and cannot be: a photo cannot be taken out of a Lightroom album,
    // so everything ever sent to edit is still sitting in KeeperEdit. Without this the check would
    // re-offer photos that were finished weeks ago — as 'unknown', since their baseline is gone with
    // them — and the list would only ever grow.
    const queued = assets.filter((asset) => verdicts.get(asset.id)?.status === 'toEdit');

    // Tidied here rather than when a photo is marked done, because undo has to be able to put that
    // decision back and would have nothing to restore the baseline from. This is the moment every
    // baseline and every verdict is already in hand, so the sweep costs nothing extra.
    const stillQueued = new Set(queued.map((asset) => asset.id));
    for (const assetId of baselines.keys()) {
      if (!stillQueued.has(assetId)) void this.forget(assetId);
    }
    // Named from the listing first. A photo is only in the metadata store if a scan has reached it,
    // and five of the thirty-six in a real KeeperEdit had not been — so those rows showed a 32-digit
    // asset id where a filename belongs, which is no more use for picking than nothing at all. The
    // listing carries `importSource.fileName` for every asset, and it was already in hand.
    const named = (asset: PhotoAsset): string =>
      asset.payload?.importSource?.fileName ?? meta.get(asset.id)?.name ?? asset.id;
    return { queued, baselines, name: named };
  }

  private async runCheck(queue: EditQueue): Promise<EditFinding[]> {
    const findings: EditFinding[] = [];
    for (const asset of queue.queued) {
      const baseline = queue.baselines.get(asset.id);
      // The whole point of the cheap pass: no download for a photo whose revision never moved.
      const hash = stampMoved(baseline, asset.updated)
        ? await this.hashFromRendition(asset.id)
        : undefined;
      const verdict = verdictFor(asset.id, baseline, asset.updated, hash);
      await this.baselineTheUnknown(verdict);
      findings.push({ ...verdict, name: queue.name(asset) });
    }
    return findings;
  }

  /**
   * A photo the check could not speak for becomes measurable from now on.
   *
   * 'unknown' means there was no earlier version to compare against — and without this that stays
   * true for ever: every run would download the photo, hash it, throw the measurement away, and
   * report the same nothing. The hash is in hand at exactly this moment, so it becomes the version
   * the *next* check compares against.
   *
   * This deliberately does not claim the photo is unedited. An edit made before this run is lost to
   * us either way, since nothing recorded what it looked like beforehand; the choice is between a
   * photo that can be answered for from now on and one that never can.
   */
  private async baselineTheUnknown(verdict: EditVerdict): Promise<void> {
    if (verdict.state !== 'unknown' || !verdict.hash) return;
    await this.captureBaseline(verdict.assetId, { hash: verdict.hash, updated: verdict.updated });
  }

  /** The queue as it stands, with no verdict on any of it — that is what the user is here to give. */
  private listRows(queue: EditQueue): EditFinding[] {
    return queue.queued.map((asset) => ({
      assetId: asset.id,
      state: 'unknown' as const,
      updated: asset.updated,
      name: queue.name(asset),
    }));
  }

  /** The check's hash, keeping the rendition it downloaded as the row's picture. */
  private async hashFromRendition(assetId: string): Promise<string | undefined> {
    const blob = await this.rendition(assetId);
    if (!blob) return undefined;
    this.remember(assetId, blob);
    try {
      return await this.hasher.hash(blob);
    } catch {
      return undefined;
    }
  }

  /** The photo as it is now, or undefined when it cannot be fetched — which reads as 'unknown'. */
  private async hashNow(assetId: string): Promise<string | undefined> {
    const blob = await this.rendition(assetId);
    if (!blob) return undefined;
    try {
      return await this.hasher.hash(blob);
    } catch {
      return undefined;
    }
  }

  /** The small rendition both the hash and the panel's thumbnail are made from. */
  private async rendition(assetId: string): Promise<Blob | undefined> {
    try {
      return await firstValueFrom(this.svc.getPhotoBlob(assetId, HASH_RENDITION));
    } catch {
      return undefined;
    }
  }

  /**
   * Fills in the pictures for rows that have none yet, one at a time so a long queue does not open
   * forty requests at once. Best-effort and unawaited: a row whose preview never arrives still shows
   * its name, and the list is usable before the last one lands.
   */
  private async loadThumbnails(assetIds: string[]): Promise<void> {
    for (const assetId of assetIds) {
      if (this.thumbnails().has(assetId)) continue;
      const blob = await this.rendition(assetId);
      if (blob) this.remember(assetId, blob);
    }
  }

  private remember(assetId: string, blob: Blob): void {
    const objectUrl = URL.createObjectURL(blob);
    this.objectUrls.push(objectUrl);
    // Safe: minted from a blob this service fetched, not from anything a user typed.
    // eslint-disable-next-line sonarjs/no-angular-bypass-sanitization
    const safeUrl = this.sanitizer.bypassSecurityTrustUrl(objectUrl);
    this.thumbnails.update((map) => new Map(map).set(assetId, safeUrl));
  }

  /** The stamp the last scan of this photo's album recorded for it. */
  private async stampFromManifest(assetId: string): Promise<string | undefined> {
    const albumId = (await this.meta.get(assetId))?.albumId;
    if (!albumId) return undefined;
    const manifest = await this.manifests.get(albumId);
    return manifest?.fingerprints.find((f) => f.id === assetId)?.updated;
  }

  /**
   * "These are done" — the edits are finished, so the photos become printable.
   *
   * <p>Everything finishing an edit means, not just the stored verdict. This wrote to the store
   * alone, and the store is not what the Edit tab reads: the queue is built from the deck held in
   * memory, so a photo said to be finished here sat in the list of things to edit until the app was
   * next reloaded, and the day's edit tally never moved. Two taps of the same meaning — "Done
   * editing" on a row, and this — have to leave the app in the same state.
   *
   * <p>Their baselines go with them: they have left the queue, and a baseline for a photo nobody is
   * editing is a row that can only ever be stale.
   */
  async sendToPrint(assetIds: readonly string[]): Promise<void> {
    for (const id of assetIds) {
      const verdict = (await this.reviews.getVerdicts()).get(id);
      await this.reviews.setVerdict(id, {
        status: 'toPrint',
        starred: verdict?.starred ?? false,
        saveOnly: verdict?.saveOnly ?? false,
      });
      await this.forget(id);
      // A photo the check found need not be on today's deck at all — the check reads the whole
      // KeeperEdit album — so this is a no-op for the ones that are not, and the tally counts the
      // finished edit either way.
      this.setDeckStatus(id, 'toPrint');
      this.progress.recordEdit();
    }
    this.dropFindings(assetIds);
  }

  /**
   * Merges Lightroom has already written, waiting to be settled.
   *
   * Read from what the scan has stored rather than from Lightroom: the merge lands in the album its
   * frames came from, not in KeeperEdit, so the listing this check is built on would never show it.
   * That does mean a panorama merged since the last scan is not seen until the next one — the same
   * wait as anything else new in the catalogue.
   *
   * Merges already settled are left out: that sweep has left the queue, and the record of what it
   * became is the thing this would otherwise offer to make again.
   */
  private async findMerges(): Promise<MergedPhoto[]> {
    const [meta, verdicts, groups, settled] = await Promise.all([
      this.meta.getAll(),
      this.reviews.getVerdicts(),
      this.groups.getAll(),
      this.mergeRecords.getAll(),
    ]);

    // The set a frame belongs to, so a merge settles every photograph behind it rather than the one
    // Lightroom happened to name it after. Any kind of group: a sweep arrives as a pano, while the
    // brackets an HDR is merged from are near-identical frames seconds apart — which is a burst.
    const setOf = new Map<string, string[]>();
    for (const group of groups) {
      for (const frameId of group.memberIds) setOf.set(frameId, group.memberIds);
    }

    const files = [...meta].map(([id, asset]) => ({ id, name: asset.name }));
    const found = findMerges(
      files,
      (assetId) => verdicts.get(assetId)?.status === 'toEdit',
      (assetId) => setOf.get(assetId),
    );
    return found.filter((merge) => !settled.has(merge.mergedId));
  }

  /**
   * "Those are one photograph now": the merge becomes the photograph, and its frames stand down.
   *
   * <p>The merge is marked as an edit finished, which is what puts it in front of the Prints tab —
   * it is the thing worth printing and the thing worth looking at, and until now it was neither,
   * being a photograph the app had no opinion about at all.
   *
   * <p>The frames are kept and set aside from printing. They are the originals and worth keeping, but
   * printing them beside the photograph they were merged into is not what anybody meant; `saveOnly` is
   * exactly that distinction and already understood by the print bins. Their baselines go too — they
   * have left the queue, so there is nothing left to compare them against.
   *
   * <p>What links the two is written down first. A merge and its sources are separate assets tied
   * together by nothing but a filename, and once the frames leave the queue nothing else would say
   * those photographs are the merge's originals.
   */
  async settleMerge(merge: MergedPhoto): Promise<void> {
    await this.mergeRecords.record(merge.mergedId, merge.frameIds);

    const verdicts = await this.reviews.getVerdicts();
    for (const frameId of merge.frameIds) {
      const verdict = verdicts.get(frameId);
      await this.reviews.setVerdict(frameId, {
        status: 'kept',
        starred: verdict?.starred ?? false,
        saveOnly: true,
      });
      await this.forget(frameId);
      this.setDeckStatus(frameId, 'kept');
    }

    await this.sendToPrint([merge.mergedId]);
    this.merges.update((list) => list.filter((one) => one.mergedId !== merge.mergedId));
  }

  /** Keeps the deck in step with a decision made from a list, for the units that are on it. */
  private setDeckStatus(assetId: string, status: 'kept' | 'toPrint'): void {
    this.feed.photos.update((list) =>
      list.map((item) => (item.id === assetId ? { ...item, status } : item)),
    );
  }

  /**
   * "Not happy with that one" — the photo stays in the queue, and what it looks like now becomes the
   * version the next check compares against.
   */
  async keepEditing(finding: EditFinding): Promise<void> {
    await this.captureBaseline(finding.assetId, { hash: finding.hash, updated: finding.updated });
    this.dropFindings([finding.assetId]);
  }

  private dropFindings(assetIds: readonly string[]): void {
    const gone = new Set(assetIds);
    this.findings.update((list) => (list ?? []).filter((f) => !gone.has(f.assetId)));
  }
}
