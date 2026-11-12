import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Photo, isUnitId } from '../../photo';
import { KeeperAlbumsService } from '../../keeper-albums.service';
import { KEEPER_EDIT_ALBUM } from '../../keeper-albums';
import { PreferencesService } from '../../preferences.service';
import { AssetMetaStore } from '../../storage/review/asset-meta-store';
import { KeeperFilingStore } from '../../storage/review/keeper-filing-store';
import { ReviewStore } from '../../storage/review/review-store';
import { CensusService } from '../../stats/census.service';
import { MANDATORY_AFTER_DAYS } from './edit-queue';
import { MergeFinderService } from './merge-finder.service';
import { EditAlbumNamesService, ListedName } from './edit-album-names.service';
import { CorrectedGroupsService } from '../deck/selection/corrected-groups.service';
import { FrameSetKind, framesByPhoto, gatherBySet } from './frame-sets';

/** One row of the Edit tab: a photograph, or a whole set shown as its longest-waiting frame. */
export interface EditCandidate extends Photo {
  /** Every frame still waiting, when this row is a set. Absent for a single photograph. */
  setFrameIds?: readonly string[];
  /** What kind of set this row is. Present exactly when {@link setFrameIds} is. */
  setKind?: FrameSetKind;
}

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
  private readonly groups = inject(CorrectedGroupsService);
  private readonly census = inject(CensusService);
  private readonly listedNames = inject(EditAlbumNamesService);

  constructor() {
    // Which rows are stereo pairs depends on album names, and the catalogue is often read after the
    // first refresh. Without this the eyes stay on separate rows until something else refreshes.
    effect(() => {
      if (this.albums.checked()) untracked(() => void this.refresh());
    });
    // A photograph deleted in Lightroom is only known to be gone once an album listing has seen its
    // tombstone, which happens in the background. Look again then, so its row goes when it can.
    effect(() => {
      if (this.census.deletionsNoted() > 0) untracked(() => void this.refresh());
    });
    // Names for photographs the scan has not reached arrive with the album listing, after the rows.
    effect(() => {
      if (this.listedNames.names().size > 0) untracked(() => void this.refresh());
    });
  }

  /** Everything in the album still waiting to be edited, the longest-waiting first. */
  readonly all = signal<EditCandidate[]>([]);

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
      const [verdicts, meta, filed, groups, deleted] = await Promise.all([
        this.reviews.getVerdicts(),
        this.meta.getAll(),
        this.filed.getAll(),
        this.groups.all(),
        this.census.seenDeleted(),
        this.finder.refresh(),
      ]);

      // Frames Lightroom has already merged into a panorama or an HDR. The work is done — what is
      // left is confirming it — so offering them again sends the user to edit photographs they have
      // already edited, which is exactly what was happening with sweeps they had stitched weeks ago.
      const merged = this.finder.frameIds();
      const listed = this.listedNames.names();

      const waiting: { photo: Photo; since: number }[] = [];
      for (const [assetId, record] of filed) {
        if (!record.albums.includes(KEEPER_EDIT_ALBUM)) continue;
        // Not a photograph: a burst or panorama card's own id, on record from before filing learned
        // to skip them. Lightroom has never held one, and it cannot be opened or edited.
        if (isUnitId(assetId)) continue;
        if (merged.has(assetId)) continue;
        // Deleted in Lightroom. Its record and its verdict outlive it — nothing here is told — so
        // without this it stays on the list as a blank row named by its id, with nothing to edit.
        if (deleted.has(assetId)) continue;
        const verdict = verdicts.get(assetId);
        if (verdict?.status !== 'toEdit') continue;
        waiting.push({
          photo: this.toPhoto(assetId, meta.get(assetId), listed.get(assetId), verdict),
          since: record.at,
        });
      }

      // Longest wait first, which is also the order the album has to be drained in: the photographs
      // at the front are the ones that become mandatory and stop anything new arriving.
      waiting.sort((a, b) => a.since - b.since);
      const setOf = framesByPhoto(groups);
      const stillWaiting = (id: string): boolean =>
        verdicts.get(id)?.status === 'toEdit' && !merged.has(id);
      this.all.set(
        gatherBySet(waiting, (one) => one.photo.id, setOf).map(([{ photo }]) => {
          const set = setOf.get(photo.id);
          // From the set rather than from what has been filed, so a frame still waiting for room in
          // the album is finished along with the rest instead of coming back as its own row. Still a
          // set with one frame left: that frame must not go to print on its own.
          const frames = set?.frameIds.filter(stillWaiting);
          return frames?.length ? { ...photo, setFrameIds: frames, setKind: set?.kind } : photo;
        }),
      );
    } catch {
      // Storage unavailable: leave the list as it was rather than claiming there is nothing to edit.
    }
  }

  /** How long a photograph has to wait before editing it becomes the price of new ones arriving. */
  readonly mandatoryAfterDays = MANDATORY_AFTER_DAYS;

  private toPhoto(
    assetId: string,
    meta: { albumId: string; name: string; ext?: string; taken: string } | undefined,
    listed: ListedName | undefined,
    { starred, saveOnly }: { starred: boolean; saveOnly: boolean },
  ): Photo {
    return {
      id: assetId,
      // A photograph the scan has not reached has no name on this device, so the album listing names
      // it. The id is the last resort, before the first listing of the session has answered: a poor
      // label but an honest one, and the row still opens the right photograph in Lightroom.
      name: meta?.name ?? listed?.name ?? assetId,
      ext: meta?.ext ?? listed?.ext,
      album: meta ? this.albums.nameFor(meta.albumId) : null,
      taken: meta?.taken ?? '',
      status: 'toEdit',
      kind: 'photo',
      starred,
      saveOnly,
    };
  }
}
