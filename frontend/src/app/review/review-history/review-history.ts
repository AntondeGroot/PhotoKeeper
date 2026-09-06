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
import { ReviewItem, unitAssetIds } from '../../photo';

/** What each outcome is called on a row, and the colour that goes with it. */
const OUTCOMES: Record<DecisionOutcome, { label: string; tone: string }> = {
  kept: { label: 'Kept', tone: 'keep' },
  rejected: { label: 'Rejected', tone: 'reject' },
  toEdit: { label: 'To edit', tone: 'print' },
  maybe: { label: 'Maybe', tone: 'maybe' },
  skipped: { label: 'Skipped', tone: 'dim' },
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

  label(outcome: DecisionOutcome): string {
    return OUTCOMES[outcome].label;
  }

  tone(outcome: DecisionOutcome): string {
    return OUTCOMES[outcome].tone;
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
