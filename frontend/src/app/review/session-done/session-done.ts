import {
  Component,
  EventEmitter,
  Input,
  Output,
  ChangeDetectionStrategy,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { CelebrationService } from '../../celebrations/celebration.service';
import { PickedCelebration } from '../../celebrations/celebration.types';
import { ReviewTotalsService } from '../review-totals.service';

@Component({
  selector: 'app-session-done',
  templateUrl: './session-done.html',
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './session-done.scss',
})
export class SessionDoneComponent implements OnInit {
  private readonly celebrations = inject(CelebrationService);
  private readonly totals = inject(ReviewTotalsService);

  @Input() keptCount!: number;
  @Input() rejectedCount!: number;
  @Input() toEditCount!: number;
  @Input() maybeCount!: number;
  @Input() canLoadMore = true;
  /** Current daily-review streak — the one genuinely cumulative counter the app keeps. */
  @Input() streakDays = 0;
  @Output() printsClick = new EventEmitter<void>();
  @Output() loadMore = new EventEmitter<void>();

  /** The celebration image for this session, once chosen. Null while loading, or if none qualifies. */
  readonly celebration = signal<PickedCelebration | null>(null);

  /**
   * This component is created at the moment a session finishes, so its own construction is the
   * signal that a celebration slot has opened — no host plumbing needed to say "now".
   */
  ngOnInit(): void {
    void this.chooseCelebration();
  }

  private async chooseCelebration(): Promise<void> {
    try {
      // Milestones read lifetime totals, not the counts on this screen — those are today's, and
      // "100 photos deleted" should mean a hundred ever, not a hundred this afternoon.
      const counters = await this.totals.counters();
      this.celebration.set(
        await this.celebrations.pickAndRecord({
          date: new Date(),
          event: 'sessionFinished',
          counters: { ...counters, streakDays: this.streakDays },
        }),
      );
    } catch {
      // The log lives in IndexedDB, which private browsing can refuse outright. A missing picture
      // is not worth failing the "all caught up" screen over.
      this.celebration.set(null);
    }
  }
}
