import { Injectable, effect, inject, signal } from '@angular/core';
import { TagReviewService } from './tagging/tag-review.service';
import { PreferencesService } from './preferences.service';
import { NotificationLaunchService } from './notifications/notification-launch.service';
import { landingFor } from './notifications/landing';

/** The three top-level tabs. */
export type Tab = 'review' | 'prints' | 'settings';

/**
 * The kinds of group a photograph can be said to belong to.
 *
 * Both are "these belong together", differing in what you are then asked. A panorama is a sweep, so
 * the frames are kept and shown as one. A burst is several tries at the same thing — which a set of
 * photographs minutes apart can be, taken from different spots while boarding a ferry — so the
 * question becomes which one of them is the keeper.
 */
export type AssembledGroup = 'pano' | 'burst';

/**
 * The steps within Daily review. Tag is optional (Settings → Features).
 *
 * Tidy is the one that is not about photographs but about Lightroom: album membership is the only
 * thing this app can write and it can only ever add, so both kinds of residue — photos left in an
 * album they have moved on from, and photos taken out of one by hand — need somewhere to be dealt
 * with. That is work on the library, done in a session, so it belongs beside the other three rather
 * than in Settings among the preferences.
 */
export type ReviewMode = 'sort' | 'edit' | 'tag' | 'tidy';

/**
 * Which screen the app is on: the tab, the step within Daily review, and whether a Settings
 * sub-screen has been drilled into.
 *
 * Its own owner rather than the app component's, because something other than a tap now decides it:
 * a reminder the user opened the app from says what it was about, and that has to land the app on the
 * matching step. Keeping the state and the one thing that redirects it together is what makes that a
 * few lines instead of a conversation between the component and three services.
 */
@Injectable({ providedIn: 'root' })
export class NavigationService {
  private readonly tagReview = inject(TagReviewService);
  private readonly prefs = inject(PreferencesService);
  private readonly launch = inject(NotificationLaunchService);

  readonly activeTab = signal<Tab>('review');
  readonly reviewMode = signal<ReviewMode>('sort');

  /**
   * Which kind of group is being assembled in the frame picker, or null when it is closed.
   *
   * Here rather than on the card because the two ends are apart: the controls sit in the strip above
   * the photo, beside the album's stereo marking, while the picker replaces the card below it. That
   * strip belongs to the review screen, not to any one card, so the state that joins them does too.
   */
  readonly groupPicking = signal<AssembledGroup | null>(null);

  openGroupPicker(type: AssembledGroup): void {
    this.groupPicking.set(type);
  }

  closeGroupPicker(): void {
    this.groupPicking.set(null);
  }

  /** Settings sub-screens, which are drilled into from the Settings tab and close when it is left. */
  readonly manageAlbumsOpen = signal(false);
  readonly tagsManagerOpen = signal(false);

  constructor() {
    effect(() => this.openWhereAsked());
  }

  setActiveTab(tab: Tab): void {
    this.activeTab.set(tab);
    // Switching tabs closes the Settings sub-screens, so returning to Settings lands on the main page
    // rather than stranding anyone who missed a back arrow.
    this.manageAlbumsOpen.set(false);
    this.tagsManagerOpen.set(false);
  }

  setReviewMode(mode: ReviewMode): void {
    if (mode === 'tag') this.tagReview.reset(); // start the tag pass at the first keeper
    this.reviewMode.set(mode);
  }

  /** Turning the optional Tag step off while standing in it falls back to Sort. */
  leaveTagModeIfDisabled(): void {
    if (!this.prefs.taggingEnabled() && this.reviewMode() === 'tag') this.reviewMode.set('sort');
  }

  /**
   * Honours a pending "open here" from a tapped reminder, then clears it.
   *
   * Clearing is what lets a second tap on the same kind of reminder land again: a signal set to the
   * value it already holds notifies nobody, so an un-cleared request would be a one-shot.
   */
  private openWhereAsked(): void {
    const spot = this.launch.requested();
    if (!spot) return;
    this.launch.requested.set(null);
    const target = landingFor(spot, this.prefs.taggingEnabled());
    this.setActiveTab(target.tab);
    if (target.mode) this.setReviewMode(target.mode);
  }
}
