import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { AssetMeta } from '../storage/photokeeper-db';
import { AssetMetaStore } from '../storage/review/asset-meta-store';
import { ReviewStore } from '../storage/review/review-store';
import { PreviewCacheService } from '../review/preview-cache.service';
import { PreferencesService } from '../preferences.service';
import { GroupStore } from '../storage/detection/group-store';
import { PhotoMergeStore } from '../storage/review/photo-merge-store';
import { shotSets } from './shot-sets';
import { DailyProgressService } from '../review/daily-progress.service';
import { ReviewUndoService, UndoEntry } from '../review/review-undo.service';
import { TagState } from './tag-state.service';
import { ASSIGNABLE_DIRS, NO_TAG, NO_TAG_DIR, NO_TAG_ID, SwipeDir, TagDirections } from './tags';
import { Photo, ReviewStatus } from '../photo';

/** Previews warmed either side of the cursor, so the next card is ready before you reach it. */
const PREFETCH_AHEAD = 3;

/** A keeper is anything sorted and not thrown out — the photos worth labelling. */
function isKeeper(status: ReviewStatus | undefined): boolean {
  return status !== undefined && status !== 'backlog' && status !== 'rejected';
}

/** A taggable photo, rebuilt from what the scan already stored about the asset. */
function toPhoto(id: string, meta: AssetMeta, status: ReviewStatus): Photo {
  return {
    id,
    name: meta.name,
    ext: meta.ext,
    album: null, // the tag card shows only the image; the album name is not worth a lookup
    taken: meta.taken,
    status,
    kind: 'photo',
    starred: false,
    saveOnly: false,
  };
}

/**
 * The optional Tag review step: a second pass over the keepers (photos already sorted into a non-reject
 * status) where the user applies content tags — by swiping a bound direction, or by toggling tags
 * directly. Owns its own cursor over that keepers pool, derived from the live review deck, and the
 * swipe-direction ↔ tag bindings (persisted via {@link PreferencesService}). Tag assignments themselves
 * live in {@link TagState}; this service is the review-step state + actions on top of it.
 */
@Injectable({ providedIn: 'root' })
export class TagReviewService {
  private readonly reviewStore = inject(ReviewStore);
  private readonly assetMeta = inject(AssetMetaStore);
  private readonly previews = inject(PreviewCacheService);
  private readonly tagState = inject(TagState);
  private readonly prefs = inject(PreferencesService);
  private readonly progress = inject(DailyProgressService);
  private readonly undoStack = inject(ReviewUndoService);
  private readonly groups = inject(GroupStore);
  private readonly merges = inject(PhotoMergeStore);

  /** Cursor over the keepers pool while in the Tag step. */
  readonly cursor = signal(0);

  /** False once a top-up finds nothing new — the whole keeper backlog has been labelled. */
  readonly canLoadMore = signal(true);

  /**
   * Every untagged keeper waiting, newest first, worked out once when the pass starts.
   *
   * Batches are slices of this. Re-deriving it per top-up meant rereading the verdicts and the
   * whole asset table and re-sorting the library to take fifteen photos — the same answer, at the
   * cost of the entire library, every time the button was pressed.
   */
  private candidates: Photo[] = [];
  /** assetId → every file that is the same photograph; rebuilt with each pool. */
  private shots = new Map<string, string[]>();

  /**
   * The Tag-step pool: keepers that still have no tags, drawn from the whole library rather than
   * from today's deck.
   *
   * Both halves matter. Excluding tagged photos is what stops the pass handing back the same
   * handful every time it is entered; going wider than the deck is what gives it somewhere to go
   * once those are done — yesterday's keepers are no longer in today's feed, so a deck-scoped pool
   * empties and then repeats itself.
   *
   * Rebuilt on entry rather than filtered live: dropping a photo the moment it is tagged would
   * shift the cursor out from under the card being looked at.
   */
  readonly taggablePhotos = signal<Photo[]>([]);

  readonly currentPhoto = computed(() => this.taggablePhotos()[this.cursor()]);

  /** The current Tag-step photo's preview, and the tag ids applied to it. */
  readonly currentPhotoUrl = computed(() => {
    const photo = this.currentPhoto();
    return photo ? this.previews.url(photo.id) : null;
  });

  readonly currentPhotoTagIds = computed(() => {
    const photo = this.currentPhoto();
    return photo ? this.tagState.tagsFor(photo.id) : [];
  });

  /**
   * Photos labelled today — the Tag-mode progress against the tagging goal.
   *
   * The day's tally rather than this sitting's. It was a counter here, zeroed by {@link load}, which
   * runs every time Tag mode is entered: leaving the tab and coming back showed 0 again, while the
   * streak — which reads this same persisted tally — already knew about the ones just done. Two
   * numbers for one fact, and the one on screen was the wrong one.
   *
   * Not derived from the pool, which is *untagged* keepers: anything labelled has left it, so there
   * is nothing there to count.
   */
  readonly taggedCount = this.progress.tags;

  readonly progressPercent = computed(() =>
    Math.min(100, (this.taggedCount() / this.prefs.tagGoal()) * 100),
  );

  constructor() {
    // Photos beyond today's deck have no cached preview, so warm a window around the cursor.
    effect(() => void this.warmAround(this.cursor()));
  }

  /** Rebuild the pass from the untagged keepers (called when entering Tag mode). */
  reset(): void {
    void this.load();
  }

  async load(): Promise<void> {
    // Best-effort: the pass is entered by tapping a tab, so a storage failure has to leave an empty
    // pool and the "nothing to tag" screen rather than rejecting into a caller that used `void`.
    this.candidates = await this.untaggedKeepers().catch(() => []);
    this.taggablePhotos.set(this.candidates.slice(0, this.prefs.tagGoal()));
    this.cursor.set(0);
    this.canLoadMore.set(this.candidates.length > this.taggablePhotos().length);
    await this.warmAround(0);
  }

  /**
   * Appends another batch, the way "Review more" does for the deck.
   *
   * A batch rather than the whole backlog, so the day has a shape: the goal is reached, the pass
   * says so, and going further is a choice. Anything already in the pool is excluded — including
   * photos labelled in this sitting, which are no longer untagged but should stay put rather than
   * shifting the cursor.
   */
  async loadMore(): Promise<void> {
    const shown = this.taggablePhotos().length;
    const more = this.candidates.slice(shown, shown + this.prefs.tagGoal());
    if (more.length === 0) {
      this.canLoadMore.set(false);
      return;
    }
    this.cursor.set(shown); // start on the first of the new batch
    this.taggablePhotos.update((pool) => [...pool, ...more]);
    this.canLoadMore.set(this.candidates.length > this.taggablePhotos().length);
    await this.warmAround(this.cursor());
  }

  /** Every keeper with no tags, newest first. */
  private async untaggedKeepers(): Promise<Photo[]> {
    const [verdicts, meta, groups, merges] = await Promise.all([
      this.reviewStore.getVerdicts(),
      this.assetMeta.getAll(),
      this.groups.getAll(),
      this.merges.getAll(),
    ]);

    this.shots = shotSets({
      names: new Map([...meta].map(([id, asset]) => [id, asset.name])),
      // Every kind of group except a burst. A sweep's frames and a stereo pair's eyes are one
      // photograph taken in pieces, but a burst is several attempts at one moment — they are judged
      // one at a time on purpose, and the ones that survive are separate photographs to label.
      groups: groups.filter((group) => group.type !== 'burst').map((group) => group.memberIds),
      merges: [...merges].map(([mergedId, record]) => [mergedId, ...record.frameIds]),
    });

    // One card per photograph, not per file. A shot whose sweep, panorama and denoise are all
    // keepers is one thing to label, and labelling it settles every file of it at once.
    const offered = new Set<string>();
    const queue: Photo[] = [];
    for (const [id, asset] of [...meta.entries()].sort(([, a], [, b]) =>
      b.taken.localeCompare(a.taken),
    )) {
      if (!isKeeper(verdicts.get(id)?.status)) continue;
      const shot = this.shotOf(id);
      if (shot.some((assetId) => this.tagState.tagsFor(assetId).length > 0)) continue;
      if (shot.some((assetId) => offered.has(assetId))) continue;
      offered.add(id);
      queue.push(toPhoto(id, asset, verdicts.get(id)!.status));
    }
    return queue;
  }

  /** Every file that is the same photograph as this one — itself alone when nothing else is. */
  private shotOf(assetId: string): string[] {
    return this.shots.get(assetId) ?? [assetId];
  }

  private async warmAround(cursor: number): Promise<void> {
    const pool = this.taggablePhotos();
    const ids = pool.slice(cursor, cursor + PREFETCH_AHEAD + 1).map((p) => p.id);
    await Promise.all(ids.map((id) => this.previews.ensure(id).catch(() => undefined)));
  }

  /**
   * Swipe in Tag mode: label the photo with that direction's tag and move on.
   *
   * The reserved corner labels it "no tag", which is a decision like any other — it settles the
   * photo, counts toward the pass, and keeps it out of a later pass over the untagged keepers.
   * An unbound direction does nothing at all: there is no answer to record, so the card stays.
   */
  swipe(dir: SwipeDir): void {
    const photo = this.currentPhoto();
    if (!photo) return;
    const tagId = dir === NO_TAG_DIR ? NO_TAG_ID : this.prefs.tagDirections()[dir];
    if (!tagId) return;
    const before = this.tagsOfShot(photo.id);
    const counted = !this.tagState.tagsFor(photo.id).length;
    for (const assetId of this.shotOf(photo.id)) this.tagState.apply(assetId, tagId);
    if (this.tagState.tagsFor(photo.id).join() !== (before[0]?.tagIds.join() ?? '')) {
      if (counted) this.progress.recordTag();
      this.remember(photo, tagId, before, counted);
    }
    this.next();
  }

  /**
   * Bind (or clear) a swipe direction to a tag. A tag lives on at most one direction, and the
   * reserved corner cannot be bound at all — it is what "none of these" means.
   */
  setDirection(change: { dir: SwipeDir; tagId: string | null }): void {
    if (change.dir === NO_TAG_DIR) return;
    this.prefs.tagDirections.update((dirs) => {
      const next: TagDirections = { ...dirs };
      if (change.tagId) {
        for (const d of ASSIGNABLE_DIRS) if (next[d] === change.tagId) delete next[d]; // unique per tag
        next[change.dir] = change.tagId;
      } else {
        delete next[change.dir];
      }
      return next;
    });
  }

  /** Apply or remove a tag on the current Tag-step photo, persisting the change. */
  toggle(tagId: string): void {
    const photo = this.currentPhoto();
    if (!photo) return;
    const before = this.tagsOfShot(photo.id);
    const had = this.tagState.tagsFor(photo.id);
    this.tagState.toggle(photo.id, tagId);
    const after = this.tagState.tagsFor(photo.id);
    if (after.join() === had.join()) return;
    // The rest of the shot is set to match, rather than toggled: they are the same photograph, and
    // toggling each would flip any that happened to disagree in the opposite direction.
    for (const assetId of this.shotOf(photo.id)) this.tagState.restore(assetId, after);
    const counted = !had.length && after.length > 0;
    if (counted) this.progress.recordTag();
    this.remember(photo, after[0] ?? NO_TAG_ID, before, counted);
  }

  /**
   * Takes a tag decision back: the photo has whatever it had before, and the cursor returns to it.
   *
   * Back to the photo rather than staying put, because a tag is only ever wrong about one
   * photograph and the point of taking it back is to answer that one again. Entries come from the
   * same list the swipes and edits are taken back from, so this is handed the one that was chosen
   * rather than assuming the last.
   */
  async undoTag(entry: UndoEntry): Promise<void> {
    if (!entry.tag) return;
    if (!(await this.undoStack.take(entry))) return;
    for (const { assetId, tagIds } of entry.tag.previous) this.tagState.restore(assetId, tagIds);
    if (entry.tag.counted) this.progress.forgetTag();
    this.cursor.set(entry.tag.cursor);
  }

  /** Names the row by the tag rather than by "Tagged", which would leave out the answer. */
  private remember(
    photo: Photo,
    tagId: string,
    previous: { assetId: string; tagIds: string[] }[],
    counted: boolean,
  ): void {
    const name = this.tagState.tags().find((tag) => tag.id === tagId)?.name;
    this.undoStack.captureTag(photo, name ?? (tagId === NO_TAG_ID ? NO_TAG.name : tagId), {
      previous,
      cursor: this.cursor(),
      counted,
    });
  }

  /** What every file of this shot was labelled with, so taking the decision back restores all of it. */
  private tagsOfShot(assetId: string): { assetId: string; tagIds: string[] }[] {
    return this.shotOf(assetId).map((id) => ({
      assetId: id,
      tagIds: [...this.tagState.tagsFor(id)],
    }));
  }

  /**
   * Advance, including one step past the last photo.
   *
   * That final step is what ends the pass: the cursor lands off the end, {@link currentPhoto} is
   * undefined, and the screen can say so. Clamping on the last photo instead left the last card
   * sitting there after it had been tagged, with nothing to say the batch was finished.
   */
  next(): void {
    if (this.cursor() < this.taggablePhotos().length) this.cursor.update((i) => i + 1);
  }

  prev(): void {
    if (this.cursor() > 0) this.cursor.update((i) => i - 1);
  }
}
