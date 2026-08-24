import { Injectable, effect, inject, signal } from '@angular/core';
import { TagReviewService } from './tagging/tag-review.service';
import { PreferencesService } from './preferences.service';
import { NotificationLaunchService } from './notifications/notification-launch.service';
import { landingFor } from './notifications/landing';

/** The three top-level tabs. */
export type Tab = 'review' | 'prints' | 'settings';

/** The steps within Daily review. Tag is optional (Settings → Features). */
export type ReviewMode = 'sort' | 'edit' | 'tag';

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
