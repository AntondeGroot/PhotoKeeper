import { Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter, fromEvent, merge as eitherOf } from 'rxjs';
import { DailyProgressService } from '../progress/daily-progress.service';
import { EditCandidatesService } from './edit-candidates.service';
import { EditDetectionService } from './edit-detection.service';
import { MergeFinderService } from './merge-finder.service';
import { MergedPhoto } from './merged-photo';

/** Where finishing a set of frames has got to. A row with no entry has not been asked yet. */
export type SetFinishState = 'searching' | 'not-found' | 'unreachable';

/**
 * Finishing a panorama or a burst, which never sends its frames to print of its own accord.
 *
 * The photograph to print is the merged file, and an album membership cannot be taken back. So
 * finishing starts by looking for that file. Until it is found nothing is written, and when there
 * is none to find the person says what happens: a panorama's frames can only be kept, while a burst
 * may simply be a burst, so its frames can also go to print on their say-so.
 *
 * A search that could not reach Lightroom is tried again when the connection returns or the app is
 * reopened, since the person has already said what they want. Those retries are held in memory on
 * purpose: after a restart the card or row is simply there to tap again, which is safe and rare.
 */
@Injectable({ providedIn: 'root' })
export class SetFinishService {
  private readonly finder = inject(MergeFinderService);
  private readonly detection = inject(EditDetectionService);
  private readonly candidates = inject(EditCandidatesService);
  private readonly progress = inject(DailyProgressService);

  readonly state = signal<ReadonlyMap<string, SetFinishState>>(new Map());

  /** What to run again for each card or row that could not reach Lightroom. */
  private readonly retries = new Map<string, () => Promise<void>>();

  constructor() {
    eitherOf(
      fromEvent(window, 'online'),
      fromEvent(document, 'visibilitychange').pipe(
        filter(() => document.visibilityState === 'visible'),
      ),
    )
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.retryWaiting());
  }

  /** "This set is done": settles it against its merged file, if Lightroom has one. */
  async finish(rowId: string, frameIds: readonly string[]): Promise<void> {
    const found = await this.search(rowId, frameIds, () => this.finish(rowId, frameIds));
    if (!found) return;
    if (found.length === 0) {
      this.setState(rowId, 'not-found');
      return;
    }
    // Merged more than once: which one is the photograph is for the person to say, and each of them
    // already has its own card in the Edit tab.
    if (found.length === 1) await this.detection.settleMerge(found[0]);
    await this.leaveQueue(rowId);
  }

  /**
   * "That's the panorama": confirms a card, once Lightroom says the file is still there.
   *
   * A card is drawn from what is on this device, which can outlive the file until the album's next
   * scan. The search corrects that record, so a deleted file takes its card with it and the sweep's
   * row comes back. The merged file's own album is read too, since that is where its tombstone is.
   */
  async confirmMerge(merge: MergedPhoto): Promise<void> {
    const found = await this.search(merge.mergedId, [...merge.frameIds, merge.mergedId], () =>
      this.confirmMerge(merge),
    );
    if (!found) return;
    if (found.some((one) => one.mergedId === merge.mergedId)) {
      await this.detection.settleMerge(merge);
      await this.leaveQueue(merge.mergedId);
      return;
    }
    this.setState(merge.mergedId, null);
    await this.candidates.refresh();
  }

  /** A card's button: confirms it or, while it is waiting to try again, stops the wait. */
  async cardTapped(merge: MergedPhoto): Promise<void> {
    if (this.state().get(merge.mergedId) === 'unreachable') this.stopTrying(merge.mergedId);
    else await this.confirmMerge(merge);
  }

  /** Changed their mind while waiting: a retry can write what cannot be undone, so it must not run. */
  stopTrying(key: string): void {
    this.retries.delete(key);
    this.setState(key, null);
  }

  /** "This burst was never going to be merged": its frames go to print, as one edit. */
  async sendFramesToPrint(rowId: string, frameIds: readonly string[]): Promise<void> {
    await this.detection.printFrames(frameIds);
    this.progress.recordEdit();
    await this.leaveQueue(rowId);
  }

  /** "I am not merging this one": the frames are kept, and none of them goes to print. */
  async finishWithoutMerge(rowId: string, frameIds: readonly string[]): Promise<void> {
    await this.detection.standDown(frameIds);
    this.progress.recordEdit();
    await this.leaveQueue(rowId);
  }

  /** The search, or null when Lightroom could not be reached and a retry has been queued. */
  private async search(
    key: string,
    assetIds: readonly string[],
    retry: () => Promise<void>,
  ): Promise<MergedPhoto[] | null> {
    this.retries.delete(key);
    this.setState(key, 'searching');
    try {
      return await this.finder.searchFor(assetIds);
    } catch {
      this.setState(key, 'unreachable');
      this.retries.set(key, retry);
      return null;
    }
  }

  /** Each attempt takes itself off the list as it starts, so a second event cannot start it again. */
  private retryWaiting(): void {
    for (const retry of [...this.retries.values()]) void retry();
  }

  private async leaveQueue(rowId: string): Promise<void> {
    this.setState(rowId, null);
    this.detection.dropFindings([rowId]);
    await this.candidates.refresh();
  }

  private setState(rowId: string, state: SetFinishState | null): void {
    this.state.update((states) => {
      const next = new Map(states);
      if (state) next.set(rowId, state);
      else next.delete(rowId);
      return next;
    });
  }
}
