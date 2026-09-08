import { Injectable, computed, inject, signal } from '@angular/core';
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
import { EditVerdict, edited, stampMoved, verdictFor } from './edit-detection';

/** One row of the check's result: the verdict, plus enough to show it. */
export interface EditFinding extends EditVerdict {
  name: string;
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

  /** What the last check found, newest run replacing the last. Null until one has been run. */
  readonly findings = signal<EditFinding[] | null>(null);
  readonly checking = signal(false);
  /** True when the album could not be read at all — the panel says so rather than "nothing found". */
  readonly failed = signal(false);

  /** The photos worth acting on: the ones whose picture changed. */
  readonly editedFindings = computed(() => edited(this.findings() ?? []));

  /** Whether the panel is on screen. */
  readonly panelOpen = signal(false);

  closePanel(): void {
    this.panelOpen.set(false);
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
      const hash = seen?.hash ?? (await this.hashes.get(assetId));
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
    if (this.checking()) return;
    this.checking.set(true);
    this.failed.set(false);
    try {
      this.findings.set(await this.runCheck());
    } catch {
      this.failed.set(true);
      this.findings.set([]);
    } finally {
      this.checking.set(false);
      this.panelOpen.set(true);
    }
  }

  private async runCheck(): Promise<EditFinding[]> {
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

    const findings: EditFinding[] = [];
    for (const asset of queued) {
      const baseline = baselines.get(asset.id);
      // The whole point of the cheap pass: no download for a photo whose revision never moved.
      const hash = stampMoved(baseline, asset.updated) ? await this.hashNow(asset.id) : undefined;
      findings.push({
        ...verdictFor(asset.id, baseline, asset.updated, hash),
        name: meta.get(asset.id)?.name ?? asset.id,
      });
    }
    return findings;
  }

  /** The photo as it is now, or undefined when it cannot be fetched — which reads as 'unknown'. */
  private async hashNow(assetId: string): Promise<string | undefined> {
    try {
      return await this.hasher.hash(
        await firstValueFrom(this.svc.getPhotoBlob(assetId, HASH_RENDITION)),
      );
    } catch {
      return undefined;
    }
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
