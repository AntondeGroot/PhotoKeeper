import { Injectable, inject, signal } from '@angular/core';
import { ReviewStore } from '../storage/review/review-store';
import { StoredVerdict } from '../storage/photokeeper-db';
import { GroupOverrideStore } from '../storage/detection/group-override-store';
import { BackgroundScanService } from '../detection/scan/background-scan.service';
import { PreferencesService } from '../preferences.service';
import { ReviewFeedService, todayKey } from './review-feed.service';
import { StreakService } from './streak.service';
import { HeadsUp } from '../notifications/heads-up/heads-up.types';
import { Burst, BurstPhoto, Pano, Photo, ReviewItem, isDevicePhoto } from '../photo';

/** Turns a dissolved burst's frame into a standalone review photo, carrying over the burst's album. */
function burstFrameToPhoto(frame: BurstPhoto, burst: Burst): Photo {
  return {
    id: frame.id,
    name: frame.name,
    album: burst.album,
    taken: burst.taken,
    status: 'backlog',
    kind: 'photo',
    starred: false,
    keepsake: false,
    ai: frame.ai,
  };
}

/**
 * The id a unit takes when re-typed. Replaces the type prefix rather than stacking another, so
 * burst→pano→burst lands back on the id it started from instead of growing `pano:burst:pano:…`
 * forever — the id keys the stored verdict and the day's feed, so every flip otherwise stranded the
 * previous key. Hydrated group ids read `burst:<albumId>:<firstMemberId>` (see unit-selection).
 */
function retypedId(type: 'burst' | 'pano', id: string): string {
  return `${type}:${id.replace(/^(?:burst:|pano:)+/, '')}`;
}

/** The everyday "you're done for today" banner. */
function goalDone(goal: number): HeadsUp {
  return {
    icon: '🎉',
    title: `That's ${goal} — daily goal done`,
    text: 'Lovely work. Everything from here is a bonus.',
  };
}

/** Shown the day a run earns a freeze — and the one place the rule is spelled out. */
function freezeUnlocked(held: number): HeadsUp {
  return {
    icon: '❄️',
    title: 'Streak freeze unlocked',
    text:
      held === 1
        ? 'One banked. It covers a day you miss, automatically.'
        : `${held} banked. Each covers a day you miss, automatically.`,
  };
}

/** Re-types a burst as a (horizontal) pano in place, keeping its frames, album, time and status. */
function burstToPano(burst: Burst): Pano {
  return {
    id: retypedId('pano', burst.id),
    name: `Panorama · ${burst.photos.length} frames`,
    album: burst.album,
    taken: burst.taken,
    status: burst.status,
    kind: 'pano',
    orientation: 'horizontal',
    frames: burst.photos.map((p) => ({ id: p.id, name: p.name, blur: p.blur })),
  };
}

/** Re-types a pano as a burst in place, keeping its frames, album, time and status. */
function panoToBurst(pano: Pano): Burst {
  return {
    id: retypedId('burst', pano.id),
    name: `Burst · ${pano.frames.length} frames`,
    album: pano.album,
    taken: pano.taken,
    status: pano.status,
    kind: 'burst',
    photos: pano.frames.map((f) => ({ id: f.id, name: f.name, blur: f.blur })),
  };
}

/**
 * Everything that happens when the user decides on a review unit: the swipe verdicts, the burst duel
 * resolution, and the burst↔pano corrections. Mutates the deck (via {@link ReviewFeedService}), persists
 * the verdict/override, then triggers the two follow-ups every decision shares — a background-scan
 * top-up and the "goal hit" celebration. The host wires {@link bindAuth} so the scan refill can re-check
 * the session at fire time.
 */
@Injectable({ providedIn: 'root' })
export class ReviewDecisionsService {
  private readonly feed = inject(ReviewFeedService);
  private readonly reviewStore = inject(ReviewStore);
  private readonly groupOverrides = inject(GroupOverrideStore);
  private readonly scan = inject(BackgroundScanService);
  private readonly prefs = inject(PreferencesService);
  private readonly streak = inject(StreakService);

  /** The current in-app celebration heads-up (or null). Celebrations only — earned, in-the-moment wins. */
  readonly celebration = signal<HeadsUp | null>(null);

  /**
   * Consecutive days the daily goal has been met, re-exposed for the header chip. Surfaced from here
   * rather than from {@link StreakService} directly because this is what advances it — the chip and
   * the goal celebration are the same event seen twice.
   */
  readonly streakDays = this.streak.days;
  readonly streakFreezes = this.streak.freezes;
  /** Today's goal met — the streak chip is only lit once it has been. */
  readonly streakMetToday = this.streak.metToday;
  /** Days a freeze covered on the way in, and the acknowledgement that clears the notice. */
  readonly freezesJustUsed = this.streak.freezesJustUsed;
  /** How many edits were promoted to print this session (drives the edit progress bar). */
  readonly editedToday = signal(0);

  private isAuthenticated: () => boolean = () => false;

  acknowledgeFreezeUse(): void {
    this.streak.acknowledgeFreezeUse();
  }

  /** Lets the host supply the session check the scan refill reads at fire time. */
  bindAuth(isAuthenticated: () => boolean): void {
    this.isAuthenticated = isAuthenticated;
  }

  decide(verdict: 'kept' | 'rejected' | 'toEdit' | 'maybe'): void {
    const current = this.feed.current();
    if (!current) return;
    this.setStatus(current.id, verdict);
    void this.persistVerdict(current.id);
    this.feed.advance();
  }

  toggleStar(): void {
    const current = this.feed.current();
    if (!current) return;
    this.feed.photos.update((list) =>
      list.map((item) =>
        item.id === current.id && item.kind === 'photo'
          ? { ...item, starred: !item.starred }
          : item,
      ),
    );
    void this.persistVerdict(current.id);
  }

  toggleKeepsake(): void {
    const current = this.feed.current();
    if (!current) return;
    this.feed.photos.update((list) =>
      list.map((item) =>
        item.id === current.id && item.kind === 'photo'
          ? { ...item, keepsake: !item.keepsake }
          : item,
      ),
    );
    void this.persistVerdict(current.id);
  }

  // Resolves a burst's duel: the winning frame is kept, every other frame rejected. Marks the burst
  // unit done (so it leaves the queue and counts toward the goal) and persists per-frame verdicts.
  resolveBurst(winnerId: string): void {
    const current = this.feed.current();
    if (current?.kind !== 'burst') return;
    this.setStatus(current.id, 'kept');
    void this.persistVerdict(current.id); // burst unit itself: done, survives reload
    for (const frame of current.photos) {
      const status = frame.id === winnerId ? ('kept' as const) : ('rejected' as const);
      void this.reviewStore.setVerdict(frame.id, { status, starred: false, keepsake: false });
    }
    this.feed.advance();
  }

  rejectBurst(): void {
    const current = this.feed.current();
    if (!current) return;
    this.setStatus(current.id, 'rejected');
    void this.persistVerdict(current.id);
    this.feed.advance();
  }

  // "Not a burst" — the user says these frames aren't a real group. Replace the burst with its frames
  // as individual photos to review now, and record an override so the group stays dissolved across
  // reloads and re-scans (selection drops it). Stays put on the first frame.
  dissolveBurst(): void {
    const current = this.feed.current();
    if (current?.kind !== 'burst') return;
    const singles = current.photos.map((frame) => burstFrameToPhoto(frame, current));
    this.feed.photos.update((list) =>
      list.flatMap((item) => (item.id === current.id ? singles : [item])),
    );
    this.persistDay();
    void this.recordDissolve(current);
  }

  /**
   * Takes an album's still-undecided units out of today's deck.
   *
   * <p>Called when an album is tagged as stereo. Its frames are halves of pairs, and judging a lone
   * eye is not merely wasteful but wrong — you would be deciding on half a photograph, and the
   * verdict would then keep that eye out of any future selection, so the pair could never be shown
   * whole. Withdrawing them costs nothing: they carry no verdict yet, and once the next scan has
   * re-detected the album (its manifest is dropped at the same moment) they come back as stereo
   * units with the eyes linked.
   *
   * <p>Only undecided units go. Anything already reviewed keeps its verdict — that decision was
   * made and removing it would silently discard it.
   */
  withdrawAlbum(album: string): void {
    const before = this.feed.photos();
    const remaining = before.filter((item) => !(item.album === album && item.status === 'backlog'));
    if (remaining.length === before.length) return;

    // Hold the cursor on whatever the user was looking at; if that was one of the withdrawn units,
    // fall to the next thing still needing a decision rather than jumping to the top of the deck.
    const current = this.feed.current();
    const kept = current ? remaining.findIndex((item) => item.id === current.id) : -1;
    const firstUndecided = remaining.findIndex((item) => item.status === 'backlog');

    this.feed.photos.set(remaining);
    this.feed.index.set(kept !== -1 ? kept : Math.max(firstUndecided, 0));
    this.persistDay();
  }

  /**
   * Re-persists today's deck after an edit to it.
   *
   * <p>Device photos are excluded. They are not part of the stored selection — {@link
   * ReviewFeedService#loadToday} rebuilds them from the source settings and *appends* them to
   * whatever it reads back, so storing them here would hand them back doubled on the next load, and
   * doubled again after the next edit.
   */
  private persistDay(): void {
    void this.reviewStore.setDailyFeed(
      todayKey(),
      this.feed.photos().filter((item) => !isDevicePhoto(item)),
    );
  }

  // "This is actually a pano" — relabel the current burst in place, persisting the correction. Stays put.
  markBurstAsPano(): void {
    const current = this.feed.current();
    if (current?.kind !== 'burst') return;
    this.replaceCurrentUnit(current, burstToPano(current));
    void this.recordReclassify(
      current.photos.map((p) => p.id),
      'pano',
      'horizontal',
    );
  }

  // "This is actually a burst" — relabel the current pano in place
  markPanoAsBurst(): void {
    const current = this.feed.current();
    if (current?.kind !== 'pano') return;
    this.replaceCurrentUnit(current, panoToBurst(current));
    void this.recordReclassify(
      current.frames.map((f) => f.id),
      'burst',
    );
  }

  promoteToPrint(id: string): void {
    this.setStatus(id, 'toPrint');
    void this.persistVerdict(id);
    this.editedToday.update((n) => n + 1);
  }

  private setStatus(id: string, status: ReviewItem['status']): void {
    this.feed.photos.update((list) =>
      list.map((item) => (item.id === id ? { ...item, status } : item)),
    );
  }

  // Swaps one review unit for a re-typed version of itself (burst↔pano), re-persisting the day's feed.
  private replaceCurrentUnit(from: ReviewItem, to: ReviewItem): void {
    this.feed.photos.update((list) => list.map((item) => (item.id === from.id ? to : item)));
    this.persistDay();
  }

  // Saves the (already-updated) unit's verdict so it survives a reload, then runs the post-decision
  // follow-ups (scan top-up + celebration). Best-effort: a storage failure must not break the flow.
  private async persistVerdict(id: string): Promise<void> {
    const item = this.feed.photos().find((p) => p.id === id);
    if (item) {
      const verdict: StoredVerdict = {
        status: item.status,
        starred: item.kind === 'photo' ? item.starred : false,
        keepsake: item.kind === 'photo' ? item.keepsake : false,
      };
      try {
        await this.reviewStore.setVerdict(id, verdict);
      } catch {
        /* ignore */
      }
    }
    // A review decision shrinks the scanned-ahead buffer — top it back up (debounced).
    this.scan.scheduleRefill(this.isAuthenticated);
    // A decision may have just carried the day's count over the sorting goal — celebrate it.
    this.maybeCelebrateGoal();
  }

  private async recordDissolve(burst: Burst): Promise<void> {
    try {
      await this.groupOverrides.dissolve({
        memberIds: burst.photos.map((p) => p.id),
        dissolvedAt: Date.now(),
      });
    } catch {
      // Best-effort correction; never break the review flow.
    }
  }

  private async recordReclassify(
    memberIds: string[],
    type: 'burst' | 'pano',
    orientation?: 'horizontal' | 'vertical',
  ): Promise<void> {
    try {
      await this.groupOverrides.reclassify({ memberIds, type, orientation, at: Date.now() });
    } catch {
      // Best-effort correction; never break the review flow.
    }
  }

  // Fires the "goal hit" celebration the moment the day's reviewed count reaches the sorting goal —
  // once per day (persisted), so reopening the app after finishing doesn't re-congratulate you. The
  // same moment is what the streak counts, so today is recorded here rather than tracked separately.
  private maybeCelebrateGoal(): void {
    if (!this.feed.loaded()) return;
    const goal = this.prefs.dailyGoal();
    const done = this.feed.photos().filter((p) => p.status !== 'backlog').length;
    if (goal <= 0 || done < goal) return;
    const today = todayKey();
    if (localStorage.getItem('celebratedGoal') === today) return;
    localStorage.setItem('celebratedGoal', today);
    // Unlocking a freeze outranks the daily goal: it happens once every sixty days, and the banner
    // is the only place the mechanic is ever explained.
    const unlockedFreeze = this.streak.recordGoalMet();
    this.celebration.set(unlockedFreeze ? freezeUnlocked(this.streak.freezes()) : goalDone(goal));
  }
}
