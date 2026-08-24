import { TestBed } from '@angular/core/testing';
import { NavigationService } from './navigation.service';
import { OS_REMINDERS, OsReminders } from './notifications/os-reminders';
import { LandingSpot } from './notifications/landing';
import { PreferencesService } from './preferences.service';

describe('NavigationService', () => {
  /** Stands in for the OS: holds the tap listener so a test can open the app from a reminder. */
  let tap: (spot: LandingSpot) => void;

  beforeEach(() => {
    localStorage.clear(); // PreferencesService seeds from localStorage on construction
    const os: OsReminders = {
      ensurePermission: () => Promise.resolve(false),
      apply: () => Promise.resolve(),
      onOpened: (listener) => (tap = listener),
    };
    TestBed.configureTestingModule({ providers: [{ provide: OS_REMINDERS, useValue: os }] });
  });

  /** Delivers a tap and lets the effect that reacts to it run. */
  function openFrom(spot: LandingSpot): void {
    tap(spot);
    TestBed.tick();
  }

  it('opens on the Edit step when the app was opened from an edit nudge', () => {
    const nav = TestBed.inject(NavigationService);

    openFrom('edit');

    expect(nav.activeTab()).toBe('review');
    expect(nav.reviewMode()).toBe('edit');
  });

  it('opens on the Tag step when the app was opened from a tag nudge', () => {
    const nav = TestBed.inject(NavigationService);
    TestBed.inject(PreferencesService).taggingEnabled.set(true);

    openFrom('tag');

    expect(nav.reviewMode()).toBe('tag');
  });

  it('opens on Sort for a tag nudge when tagging has since been switched off', () => {
    const nav = TestBed.inject(NavigationService);
    TestBed.inject(PreferencesService).taggingEnabled.set(false);

    openFrom('tag');

    expect(nav.reviewMode()).toBe('sort');
  });

  it('opens the Prints tab when the app was opened from a prints nudge', () => {
    const nav = TestBed.inject(NavigationService);

    openFrom('prints');

    expect(nav.activeTab()).toBe('prints');
  });

  it('lands again on a second tap of the same kind of reminder', () => {
    // The request is cleared once honoured, because a signal set to the value it already holds
    // notifies nobody — without the clear, only the first tap of each kind would ever land.
    const nav = TestBed.inject(NavigationService);
    openFrom('edit');
    nav.setReviewMode('sort'); // the user wandered back to Sort

    openFrom('edit');

    expect(nav.reviewMode()).toBe('edit');
  });

  it('leaves the app where it is when it was not opened from a reminder', () => {
    const nav = TestBed.inject(NavigationService);

    TestBed.tick();

    expect(nav.activeTab()).toBe('review');
    expect(nav.reviewMode()).toBe('sort');
  });

  describe('manage-albums sub-screen', () => {
    it('closes when switching tabs, so returning to Settings shows the main page', () => {
      const nav = TestBed.inject(NavigationService);

      nav.setActiveTab('settings');
      nav.manageAlbumsOpen.set(true); // user drilled into Manage albums

      nav.setActiveTab('review'); // navigate away
      expect(nav.manageAlbumsOpen()).toBe(false);

      nav.setActiveTab('settings'); // back to Settings → main page, not stranded in Manage albums
      expect(nav.manageAlbumsOpen()).toBe(false);
    });
  });
});
