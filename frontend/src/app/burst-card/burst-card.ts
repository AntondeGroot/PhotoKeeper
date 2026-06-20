import {
  Component,
  EventEmitter,
  Input,
  Output,
  computed,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { SafeUrl } from '@angular/platform-browser';
import { Burst } from '../photo';

@Component({
  selector: 'app-burst-card',
  templateUrl: './burst-card.html',
  styleUrl: './burst-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
})
export class BurstCardComponent {
  // Setting a new burst resets the tournament: the first survivor is the champion, frame 1 challenges.
  // Frames are de-duplicated by id first — a burst should never list the same asset twice, but if one
  // slips through (e.g. an already-cached feed) the duel would pit a frame against itself.
  @Input() set burst(value: Burst) {
    const seen = new Set<string>();
    const photos = value.photos.filter((p) => !seen.has(p.id) && seen.add(p.id));
    const deduped = { ...value, photos };
    this.burstSig.set(deduped);
    this.championId.set(photos.find((p) => !p.blur)?.id ?? '');
    this.challengerIdx.set(1);
  }
  @Input() imageUrls = new Map<string, SafeUrl>();
  /** The winning frame's id, emitted once the tournament resolves. */
  @Output() picked = new EventEmitter<string>();
  @Output() rejectedAll = new EventEmitter<void>();
  @Output() dissolved = new EventEmitter<void>();
  /** "This isn't a burst, it's a pano" — relabel the group so it's reviewed as a panorama instead. */
  @Output() reclassified = new EventEmitter<void>();
  /**
   * Open the current duel pair (or lone survivor) full screen to compare, starting on the tapped
   * frame so it shows first with its tab highlighted.
   */
  @Output() compare = new EventEmitter<{ ids: string[]; start: number }>();

  private readonly burstSig = signal<Burst | null>(null);
  private readonly championId = signal('');
  readonly challengerIdx = signal(1);

  readonly survivors = computed(() => this.burstSig()?.photos.filter((p) => !p.blur) ?? []);
  readonly excluded = computed(() => this.burstSig()?.photos.filter((p) => p.blur) ?? []);
  readonly champion = computed(() => this.survivors().find((p) => p.id === this.championId()));
  readonly totalDuels = computed(() => Math.max(0, this.survivors().length - 1));

  /** The active A-vs-B pair, or null when there's nothing left to duel (0 or 1 survivors). */
  readonly duel = computed(() => {
    const a = this.champion();
    const b = this.survivors().at(this.challengerIdx());
    return a && b ? { a, b } : null;
  });

  /** Records the winner of the current pair; advances to the next challenger or resolves the burst. */
  chooseWinner(winnerId: string): void {
    this.championId.set(winnerId);
    const next = this.challengerIdx() + 1;
    if (next < this.survivors().length) {
      this.challengerIdx.set(next);
    } else {
      this.picked.emit(winnerId);
    }
  }

  /** Single-survivor case: keep it without a duel. */
  keepChampion(): void {
    const champ = this.champion();
    if (champ) this.picked.emit(champ.id);
  }
}
