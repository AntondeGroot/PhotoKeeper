import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  inject,
} from '@angular/core';
import { SafeUrl } from '@angular/platform-browser';
import { DecisionOutcome, UndoEntry } from '../review-undo.service';
import { PreviewCacheService } from '../preview-cache.service';
import { VERDICT_STYLE } from '../../verdicts';
import { ReviewItem, unitAssetIds } from '../../photo';

/**
 * What each outcome is called on a row, and the colour that goes with it.
 *
 * The four verdicts take theirs from {@link VERDICT_STYLE}, the description every review screen
 * reads — this list said teal for "to edit" while the card said amber, and a screen built later
 * copied the wrong one. The other three have no description of their own to read: a photo skipped,
 * an edit finished, a tag given. Their colours are the app's meanings for those (Prints teal, the
 * album-tag mauve), restated here for want of a shared description of an outcome.
 */
const OUTCOMES: Record<DecisionOutcome, { label: string; colour: string }> = {
  kept: { label: 'Kept', colour: VERDICT_STYLE.kept.colour },
  rejected: { label: 'Rejected', colour: VERDICT_STYLE.rejected.colour },
  toEdit: { label: 'To edit', colour: VERDICT_STYLE.toEdit.colour },
  maybe: { label: 'Maybe', colour: VERDICT_STYLE.maybe.colour },
  toPrint: { label: 'Done editing', colour: 'var(--c-print)' },
  skipped: { label: 'Skipped', colour: 'var(--c-dim)' },
  // Named by the tag itself on the row; this is only the fallback and the colour.
  tagged: { label: 'Tagged', colour: 'var(--c-holiday)' },
};

/**
 * The decisions of this session that can still be taken back, newest first.
 *
 * <p>A list rather than a single undo button, because a mis-swipe is often noticed a few photos
 * later — by which time "undo" has to mean a particular photo, not "the last thing I did". Seeing
 * the judgement next to the photograph is also the only way to check a run of swipes went where you
 * meant them to.
 *
 * <p>It ends where it does for a reason worth saying out loud: everything older has been written
 * into the Keeper albums, and Lightroom's API cannot take a photo back out of one.
 */
@Component({
  selector: 'app-review-history',
  templateUrl: './review-history.html',
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './review-history.scss',
})
export class ReviewHistoryComponent {
  // Read directly rather than handed down, as the Prints tab's list does: every photo here sits
  // behind the review cursor, outside the host's prefetch window, so the host has no map to give.
  // ReviewFeedService warms and pins them for as long as the list is open.
  private readonly previews = inject(PreviewCacheService);

  /** The decisions to show, most recent first. */
  @Input({ required: true }) entries: readonly UndoEntry[] = [];
  @Output() undone = new EventEmitter<UndoEntry>();
  @Output() closed = new EventEmitter<void>();

  /**
   * What the row's chip says: the entry's own label when it has one, else the outcome's name.
   *
   * A tag decision carries the tag's name, because the answer *is* which tag — a row reading
   * "Tagged" would leave out the only part worth checking.
   */
  label(entry: UndoEntry): string {
    return entry.label ?? OUTCOMES[entry.outcome].label;
  }

  /** The chip's colour; the border follows it through `currentColor`. */
  colour(outcome: DecisionOutcome): string {
    return OUTCOMES[outcome].colour;
  }

  /** The frame a row shows: a single photo, or the first frame of a group. */
  thumbnail(unit: ReviewItem): SafeUrl | null {
    const first = unitAssetIds(unit)[0];
    return first ? this.previews.url(first) : null;
  }

  /** How many photographs a row stands for, so a group does not read as one photo. */
  frameCount(unit: ReviewItem): number {
    return unitAssetIds(unit).length;
  }
}
