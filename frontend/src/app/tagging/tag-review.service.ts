import { Injectable, computed, inject, signal } from '@angular/core';
import { ReviewFeedService } from '../review/review-feed.service';
import { PreviewCacheService } from '../review/preview-cache.service';
import { PreferencesService } from '../preferences.service';
import { TagState } from './tag-state.service';
import { SWIPE_DIRS, SwipeDir, TagDirections } from './tags';
import { Photo } from '../photo';

/**
 * The optional Tag review step: a second pass over the keepers (photos already sorted into a non-reject
 * status) where the user applies content tags — by swiping a bound direction, or by toggling tags
 * directly. Owns its own cursor over that keepers pool, derived from the live review deck, and the
 * swipe-direction ↔ tag bindings (persisted via {@link PreferencesService}). Tag assignments themselves
 * live in {@link TagState}; this service is the review-step state + actions on top of it.
 */
@Injectable({ providedIn: 'root' })
export class TagReviewService {
  private readonly feed = inject(ReviewFeedService);
  private readonly previews = inject(PreviewCacheService);
  private readonly tagState = inject(TagState);
  private readonly prefs = inject(PreferencesService);

  /** Cursor over the keepers pool while in the Tag step. */
  readonly cursor = signal(0);

  /** The Tag-step pool: single photos already sorted into a keeper status (not backlog, not rejected). */
  readonly taggablePhotos = computed(() =>
    this.feed
      .photos()
      .filter(
        (p): p is Photo => p.kind === 'photo' && p.status !== 'backlog' && p.status !== 'rejected',
      ),
  );

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

  /** How many keepers have at least one tag — the Tag-mode progress against the tagging goal. */
  readonly taggedCount = computed(
    () => this.taggablePhotos().filter((p) => this.tagState.tagsFor(p.id).length > 0).length,
  );

  readonly progressPercent = computed(() =>
    Math.min(100, (this.taggedCount() / this.prefs.tagGoal()) * 100),
  );

  /** Restart the pass at the first keeper (called when entering Tag mode). */
  reset(): void {
    this.cursor.set(0);
  }

  /** Swipe in Tag mode: apply that direction's bound tag to the current photo, then advance. */
  swipe(dir: SwipeDir): void {
    const tagId = this.prefs.tagDirections()[dir];
    const photo = this.currentPhoto();
    if (!tagId || !photo) return;
    this.tagState.apply(photo.id, tagId);
    this.next();
  }

  /** Bind (or clear) a swipe direction to a tag. A tag lives on at most one direction. */
  setDirection(change: { dir: SwipeDir; tagId: string | null }): void {
    this.prefs.tagDirections.update((dirs) => {
      const next: TagDirections = { ...dirs };
      if (change.tagId) {
        for (const d of SWIPE_DIRS) if (next[d] === change.tagId) delete next[d]; // unique per tag
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
    if (photo) this.tagState.toggle(photo.id, tagId);
  }

  next(): void {
    if (this.cursor() < this.taggablePhotos().length - 1) this.cursor.update((i) => i + 1);
  }

  prev(): void {
    if (this.cursor() > 0) this.cursor.update((i) => i - 1);
  }
}
