import { Injectable, inject } from '@angular/core';
import { pairEditsToOriginals } from '../edit-pairs';
import { AssetMetaStore } from '../storage/review/asset-meta-store';
import { ReviewStore } from '../storage/review/review-store';

/**
 * Gives an original the verdict its edit already carries.
 *
 * An edited pair is one card over two files — the shot and the denoise Lightroom wrote beside it —
 * and the card's id is the edit's. A verdict recorded there alone left the original holding none:
 * a photograph the user had ruled on that the app still counted as backlog, so it was never filed
 * to Lightroom and came back on the deck as soon as anything stopped the two being folded together.
 * Fifty-five of them had built up on a real catalogue before the cause was found.
 *
 * {@link ReviewDecisionsService.decide} now records both, so this is here for the ones written
 * before it did. Left as a standing repair rather than a one-off migration: it costs one pass over
 * data already in memory, it can only ever fill a gap (never change a decision), and a rule that
 * heals whatever it finds needs no record of having run.
 */
@Injectable({ providedIn: 'root' })
export class EditVerdictRepairService {
  private readonly meta = inject(AssetMetaStore);
  private readonly reviews = inject(ReviewStore);

  /** Fills in the missing originals, and says how many it filled. Best-effort by design. */
  async repair(): Promise<number> {
    const [meta, verdicts] = await Promise.all([this.meta.getAll(), this.reviews.getVerdicts()]);
    const pairs = pairEditsToOriginals([...meta].map(([id, asset]) => ({ id, name: asset.name })));

    let filled = 0;
    for (const [editId, originalId] of pairs) {
      const decided = verdicts.get(editId);
      // Only a gap is filled. An original that carries a verdict of its own was ruled on directly,
      // and the edit's is not entitled to overwrite it.
      if (!decided || verdicts.has(originalId)) continue;
      await this.reviews.setVerdict(originalId, { ...decided });
      filled++;
    }
    return filled;
  }
}
