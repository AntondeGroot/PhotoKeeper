import { Injectable, computed, inject, signal } from '@angular/core';
import { Photo, isUnitId } from '../photo';
import { KeeperAlbumsService } from '../keeper-albums.service';
import { KEEPER_EDIT_ALBUM } from '../keeper-albums';
import { PreferencesService } from '../preferences.service';
import { AssetMetaStore } from '../storage/review/asset-meta-store';
import { KeeperFilingStore } from '../storage/review/keeper-filing-store';
import { ReviewStore } from '../storage/review/review-store';
import { MANDATORY_AFTER_DAYS } from './edit-queue';
import { MergeFinderService } from './merge-finder.service';

/**
 * What there is to edit — the whole album, not today's deck.
 *
 * The Edit tab used to list the photographs of today's review deck that happened to be marked for
 * editing, which is a handful at most and often none: a day spent tagging, or a deck already
 * finished, left the tab saying the queue was clear while KeeperEdit held four hundred photographs
 * waiting for exactly this. Editing is not a daily selection the way reviewing is — the album is
 * standing work, and the tab's job is to offer the next few of it.
 *
 * Only photographs Lightroom actually has. One decided for editing but still waiting for room in the
 * album cannot be edited yet, and offering it would send the user to a photograph that is not there.
 */
@Injectable({ providedIn: 'root' })
export class EditCandidatesService {
  private readonly reviews = inject(ReviewStore);
  private readonly meta = inject(AssetMetaStore);
  private readonly filed = inject(KeeperFilingStore);
  private readonly albums = inject(KeeperAlbumsService);
  private readonly prefs = inject(PreferencesService);
  private readonly finder = inject(MergeFinderService);

  /** Everything in the album still waiting to be edited, the longest-waiting first. */
  readonly all = signal<Photo[]>([]);

  /** The few to offer now — the editing goal's worth, taken off the front. */
  readonly batch = computed(() => this.all().slice(0, this.prefs.editGoal()));

  /** True only when the album itself has nothing left, not merely today's deck. */
  readonly empty = computed(() => this.all().length === 0);

  /** Sets already merged into one photograph, waiting only to be confirmed. */
  readonly merges = this.finder.merges;

  /**
   * Re-reads what is waiting. Cheap: three reads of data already on the device, no network.
   *
   * Called when a day loads and whenever something leaves the queue, because the list is what the
   * user works from — one that still offers a photograph they have just finished is worse than one
   * that is a few seconds stale.
   */
  async refresh(): Promise<void> {
    try {
      const [verdicts, meta, filed] = await Promise.all([
        this.reviews.getVerdicts(),
        this.meta.getAll(),
        this.filed.getAll(),
        this.finder.refresh(),
      ]);

      // Frames Lightroom has already merged into a panorama or an HDR. The work is done — what is
      // left is confirming it — so offering them again sends the user to edit photographs they have
      // already edited, which is exactly what was happening with sweeps they had stitched weeks ago.
      const merged = this.finder.frameIds();

      const waiting: { photo: Photo; since: number }[] = [];
      for (const [assetId, record] of filed) {
        if (!record.albums.includes(KEEPER_EDIT_ALBUM)) continue;
        // Not a photograph: a burst or panorama card's own id, on record from before filing learned
        // to skip them. Lightroom has never held one, and it cannot be opened or edited.
        if (isUnitId(assetId)) continue;
        if (merged.has(assetId)) continue;
        const verdict = verdicts.get(assetId);
        if (verdict?.status !== 'toEdit') continue;
        waiting.push({
          photo: this.toPhoto(assetId, meta.get(assetId), verdict.starred, verdict.saveOnly),
          since: record.at,
        });
      }

      // Longest wait first, which is also the order the album has to be drained in: the photographs
      // at the front are the ones that become mandatory and stop anything new arriving.
      waiting.sort((a, b) => a.since - b.since);
      this.all.set(waiting.map((one) => one.photo));
    } catch {
      // Storage unavailable: leave the list as it was rather than claiming there is nothing to edit.
    }
  }

  /** How long a photograph has to wait before editing it becomes the price of new ones arriving. */
  readonly mandatoryAfterDays = MANDATORY_AFTER_DAYS;

  private toPhoto(
    assetId: string,
    meta: { albumId: string; name: string; ext?: string; taken: string } | undefined,
    starred: boolean,
    saveOnly: boolean,
  ): Photo {
    return {
      id: assetId,
      // A photograph the scan has not reached has no name on this device. Its id is a poor label but
      // an honest one, and the row still opens the right photograph in Lightroom.
      name: meta?.name ?? assetId,
      ext: meta?.ext,
      album: meta ? this.albums.nameFor(meta.albumId) : null,
      taken: meta?.taken ?? '',
      status: 'toEdit',
      kind: 'photo',
      starred,
      saveOnly,
    };
  }
}
