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
import { Burst } from '../../photo';

/**
 * The burst duel: near-identical frames shown two at a time until the set is decided.
 *
 * Every answer is final for the frames it names, and the ones already answered for are never
 * revisited — which is the whole point of the "keep both" answer existing. Before it did, a pair you
 * both wanted left you with nothing to say but "not a burst", and that put the whole set back on the
 * deck as undecided singles: the frames you had already thrown out came back, and the work of
 * getting there was gone.
 */
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
    this.startRound(photos.find((p) => !p.blur)?.id ?? '');
  }
  @Input() imageUrls = new Map<string, SafeUrl>();
  /**
   * The frames to keep, emitted once the set is decided. Everything else in the burst is rejected,
   * so this one list carries the whole outcome — including the empty list, which is "none of them".
   */
  @Output() resolved = new EventEmitter<string[]>();
  @Output() rejectedAll = new EventEmitter<void>();
  /** "This isn't a burst, it's a pano" — relabel the group so it's reviewed as a panorama instead. */
  @Output() reclassified = new EventEmitter<void>();
  /**
   * Open the current duel pair (or lone survivor) full screen to compare, starting on the tapped
   * frame so it shows first with its tab highlighted.
   */
  @Output() compare = new EventEmitter<{ ids: string[]; start: number }>();

  private readonly burstSig = signal<Burst | null>(null);
  /**
   * The frames the duel settled on, once it is over — null while it is still running.
   *
   * Held rather than emitted straight away so the set can be run again. Two frames of a burst that
   * both survived are often two frames of the *same* moment, and the choice between them is easier
   * once everything else is gone; going round again asks it with the losers cleared away. Only
   * offered when more than one survived: a round with a single frame has nothing to ask.
   */
  private readonly settled = signal<string[] | null>(null);
  private readonly championId = signal('');
  /** Frames answered "keep" so far. Kept here, not emitted yet, so the burst stays one decision. */
  private readonly keptIds = signal<string[]>([]);
  readonly challengerIdx = signal(1);

  readonly survivors = computed(() => this.burstSig()?.photos.filter((p) => !p.blur) ?? []);
  readonly excluded = computed(() => this.burstSig()?.photos.filter((p) => p.blur) ?? []);
  readonly champion = computed(() => this.survivors().find((p) => p.id === this.championId()));
  readonly totalDuels = computed(() => Math.max(0, this.survivors().length - 1));

  /** How many frames are already decided, so the card can say the work so far is safe. */
  readonly keptSoFar = computed(() => this.keptIds().length);

  /**
   * Everything not thrown out: the frames kept along the way, the champion still standing, and the
   * ones the duel has not reached. In their original order, so starting over is the same tournament
   * over fewer frames rather than a reshuffle.
   */
  readonly stillInPlay = computed(() => {
    const standing = new Set(this.keptIds());
    const champion = this.champion();
    if (champion) standing.add(champion.id);
    for (const frame of this.survivors().slice(this.challengerIdx())) standing.add(frame.id);
    return this.survivors().filter((frame) => standing.has(frame.id));
  });

  /**
   * Whether starting over would ask a different question. Until something has been thrown out it
   * would replay the identical tournament and quietly discard any "keep both" already answered, so
   * it is not offered.
   */
  readonly canStartOver = computed(
    () => this.stillInPlay().length > 1 && this.stillInPlay().length < this.survivors().length,
  );

  /** The frames that survived, once the duel is over — what the closing screen reports. */
  readonly settledIds = computed(() => this.settled());
  /** Whether there is a narrower question left to ask. One survivor is already an answer. */
  readonly canGoAgain = computed(() => (this.settled()?.length ?? 0) > 1);

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
      this.finish([...this.keptIds(), winnerId]);
    }
  }

  /**
   * "Keep both photos" — this pair are both worth keeping, so both are settled and the duel moves on
   * to whatever is left. Nothing already decided is touched: that was the fault this replaced.
   */
  keepBoth(): void {
    const pair = this.duel();
    if (!pair) return;
    this.keptIds.update((kept) => [...kept, pair.a.id, pair.b.id]);
    this.advancePastPair();
  }

  /** "Reject both photos" — neither of this pair is worth keeping; carry on with the rest. */
  rejectBoth(): void {
    if (!this.duel()) return;
    this.advancePastPair();
  }

  /** Single-survivor case: keep it without a duel. */
  keepChampion(): void {
    const champ = this.champion();
    if (champ) this.finish([...this.keptIds(), champ.id]);
  }

  /** The lone survivor isn't worth keeping either — settle the burst on what was kept before it. */
  rejectChampion(): void {
    if (this.champion()) this.finish(this.keptIds());
  }

  /**
   * Both frames of the pair are settled, so neither carries on as champion: the next frame takes
   * over, duelling the one after it. With one frame left there is nobody to duel, and it is offered
   * on its own; with none left the burst is done.
   */
  private advancePastPair(): void {
    const next = this.survivors().at(this.challengerIdx() + 1);
    if (!next) {
      this.finish(this.keptIds());
      return;
    }
    this.championId.set(next.id);
    this.challengerIdx.set(this.challengerIdx() + 2);
  }

  /**
   * The duel is over. With more than one frame left it stops here and offers another round; with one
   * or none there is nothing further to ask, so the burst settles without an extra tap.
   */
  private finish(keptIds: string[]): void {
    if (keptIds.length > 1) {
      this.settled.set(keptIds);
      return;
    }
    this.resolved.emit(keptIds);
  }

  /** Duel the survivors again. Frames dropped in an earlier round stay dropped. */
  anotherRound(): void {
    const kept = this.settled();
    if (!kept || kept.length < 2) return;
    this.restartWith(kept);
  }

  /**
   * Start the tournament again over what is left, without waiting for it to finish.
   *
   * <p>Three duels in, it can be clear that the run was being judged on the wrong thing — and until
   * now the only way to ask again was to play it out first. This carries forward everything still
   * standing: the frames kept along the way, the current champion, and the ones the duel has not
   * reached yet. Only what was explicitly thrown out stays out, which is the whole point — that work
   * was real, and starting over must not undo it.
   */
  startOver(): void {
    const inPlay = this.stillInPlay();
    if (inPlay.length < 2) return;
    this.restartWith(inPlay.map((frame) => frame.id));
  }

  /** Re-runs the duel over `ids` only, in their original order. */
  private restartWith(ids: string[]): void {
    const burst = this.burstSig();
    if (!burst) return;
    const keeping = new Set(ids);
    const photos = burst.photos.filter((p) => keeping.has(p.id));
    this.burstSig.set({ ...burst, photos });
    this.startRound(photos.find((p) => !p.blur)?.id ?? '');
  }

  /** Settle the burst on what survived. */
  done(): void {
    const kept = this.settled();
    if (kept) this.resolved.emit(kept);
  }

  /** Puts the tournament back to its first duel over whatever frames are in play. */
  private startRound(championId: string): void {
    this.championId.set(championId);
    this.challengerIdx.set(1);
    this.keptIds.set([]);
    this.settled.set(null);
  }
}
