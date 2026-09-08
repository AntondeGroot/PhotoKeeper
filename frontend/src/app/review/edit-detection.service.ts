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
import { ReviewStore } from '../storage/review/review-store';
import { EditBaseline, EditVerdict, edited, stampMoved, verdictFor } from './edit-detection';
import { PhotoAsset } from '../lightroom-types';

/** One row of the check's result: the verdict, plus enough to show it. */
export interface EditFinding extends EditVerdict {
  name: string;
}

/** The edit queue as both buttons need it: what is waiting, and what is known about each photo. */
interface EditQueue {
  queued: PhotoAsset[];
  baselines: ReadonlyMap<string, EditBaseline>;
  name: (assetId: string) => string;
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
  private readonly reviews = inject(ReviewStore);
  private readonly hasher = inject(ImageHasher);
  private readonly sanitizer = inject(DomSanitizer);

  /** What the last check found, newest run replacing the last. Null until one has been run. */
  readonly findings = signal<EditFinding[] | null>(null);
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
      // Only what the panel will actually show. Fetching a picture for the rest would undo the cheap
      // pass — whose whole point is that a photo whose revision never moved is never downloaded.
      void this.loadThumbnails(this.shownFindings().map((finding) => finding.assetId));
    } catch {
      this.failed.set(true);
      this.findings.set([]);
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
    return { queued, baselines, name: (id: string) => meta.get(id)?.name ?? id };
  }

  private async runCheck(queue: EditQueue): Promise<EditFinding[]> {
    const findings: EditFinding[] = [];
    for (const asset of queue.queued) {
      const baseline = queue.baselines.get(asset.id);
      // The whole point of the cheap pass: no download for a photo whose revision never moved.
      const hash = stampMoved(baseline, asset.updated)
        ? await this.hashFromRendition(asset.id)
        : undefined;
      findings.push({
        ...verdictFor(asset.id, baseline, asset.updated, hash),
        name: queue.name(asset.id),
      });
    }
    return findings;
  }

  /** The queue as it stands, with no verdict on any of it — that is what the user is here to give. */
  private listRows(queue: EditQueue): EditFinding[] {
    return queue.queued.map((asset) => ({
      assetId: asset.id,
      state: 'unknown' as const,
      updated: asset.updated,
      name: queue.name(asset.id),
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
   * Their baselines go with them: they have left the queue, and a baseline for a photo nobody is
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
    }
    this.dropFindings(assetIds);
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
