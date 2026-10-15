import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

/**
 * Shown over the app when a streak freeze covered a day that was missed.
 *
 * It appears on opening rather than at the end of a session, because it is news about days already
 * gone: by the time you have finished today's review it is stale, and it would be competing with a
 * celebration about the work you just did.
 *
 * Deliberately a dismissible notice rather than a toast — the point is that something was spent on
 * your behalf without asking, and that deserves an acknowledgement rather than a banner that slides
 * away while you are still reading it.
 */
@Component({
  selector: 'app-streak-frozen-notice',
  templateUrl: './streak-frozen-notice.html',
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './streak-frozen-notice.scss',
})
export class StreakFrozenNoticeComponent {
  /** Days that were covered — one freeze each. */
  @Input({ required: true }) daysCovered!: number;
  /** Freezes still banked afterwards, so the notice can say what it cost. */
  @Input({ required: true }) freezesLeft!: number;
  @Input() streakDays = 0;
  @Output() dismissed = new EventEmitter<void>();

  get missedLabel(): string {
    return this.daysCovered === 1 ? 'a day' : `${this.daysCovered} days`;
  }

  get costLabel(): string {
    const spent = this.daysCovered === 1 ? 'A freeze' : `${this.daysCovered} freezes`;
    if (this.freezesLeft === 0) return `${spent} covered it. That was your last one.`;
    const left = this.freezesLeft === 1 ? '1 left' : `${this.freezesLeft} left`;
    return `${spent} covered it — ${left}.`;
  }
}
