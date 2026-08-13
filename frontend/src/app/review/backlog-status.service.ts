import { Injectable, inject } from '@angular/core';
import { PreferencesService } from '../preferences.service';
import { AssetMetaStore } from '../storage/review/asset-meta-store';
import { AssetTagStore } from '../storage/tags/asset-tag-store';
import { ReviewStore } from '../storage/review/review-store';

/**
 * Whether there is any daily task left to do, across the whole library rather than today's deck.
 *
 * This is what lets a streak pause instead of breaking: with everything sorted, edited and tagged
 * there is no task to forget, so the days spent waiting for prints to arrive cost neither the run
 * nor a freeze. See {@link settleStreak}.
 *
 * Deliberately not built from the counts on the review screen — those describe *today's feed*, so
 * they read empty the moment a day is finished. Using them would make every completed day look
 * dormant and no streak would ever break.
 *
 * Work is anything the user can act on now:
 * - assets never reviewed;
 * - photos flagged `toEdit` and not yet edited (editing moves them on to `toPrint`);
 * - keepers still untagged, when tagging is switched on.
 *
 * `toPrint` is excluded on purpose: an album ordered and in the post is not something you can do
 * anything about. `rejected` is excluded because nothing in the app acts on it — the Lightroom
 * write-back that would actually remove those photos does not exist yet, so counting them would
 * mean work is "available" forever after the first rejection.
 */
@Injectable({ providedIn: 'root' })
export class BacklogStatusService {
  private readonly meta = inject(AssetMetaStore);
  private readonly reviews = inject(ReviewStore);
  private readonly tags = inject(AssetTagStore);
  private readonly prefs = inject(PreferencesService);

  async hasWorkWaiting(): Promise<boolean> {
    const [meta, verdicts] = await Promise.all([this.meta.getAll(), this.reviews.getVerdicts()]);

    // An empty population means the scan has not run yet, not that the library is clear. Claiming
    // "nothing to do" there would quietly stop streaks ever breaking, so assume there is work.
    if (meta.size === 0) return true;

    for (const id of meta.keys()) {
      const status = verdicts.get(id)?.status ?? 'backlog';
      if (status === 'backlog') return true;
    }
    for (const verdict of verdicts.values()) {
      if (verdict.status === 'toEdit') return true;
    }
    return this.prefs.taggingEnabled() ? this.hasUntaggedKeepers(verdicts) : false;
  }

  private async hasUntaggedKeepers(verdicts: Map<string, { status: string }>): Promise<boolean> {
    const tags = await this.tags.getAll();
    for (const [id, verdict] of verdicts) {
      const isKeeper = verdict.status === 'kept' || verdict.status === 'toPrint';
      if (isKeeper && !tags[id]?.length) return true;
    }
    return false;
  }
}
