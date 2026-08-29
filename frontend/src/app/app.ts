import {
  Component,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { SafeUrl } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import { Album, isAuthFailure, LightroomService } from './lightroom.service';
import { PreviewCacheService } from './review/preview-cache.service';
import { ReviewFeedService } from './review/review-feed.service';
import { ReviewDecisionsService } from './review/review-decisions.service';
import { ReviewStatsService } from './review/review-stats.service';
import { FullscreenViewerService } from './review/fullscreen-viewer.service';
import { CatalogScanService } from './detection/scan/catalog-scan.service';
import { DetectionSettingsService } from './detection/scan/detection-settings.service';
import { BackgroundScanService } from './detection/scan/background-scan.service';
import { PanoFrame, Photo, ReviewItem, isDevicePhoto, unitAssetIds } from './photo';
import { ReviewSortComponent } from './review/review-sort/review-sort';
import { ReviewAlbumTagsComponent } from './review/review-album-tags/review-album-tags';
import { StreakFrozenNoticeComponent } from './review/streak-frozen-notice/streak-frozen-notice';
import { SessionDoneComponent } from './review/session-done/session-done';
import { ReviewEditComponent } from './review/review-edit/review-edit';
import { PrintsComponent } from './prints/prints';
import { SettingsComponent } from './settings/settings';
import { BurstCardComponent } from './review/burst-card/burst-card';
import { PanoCardComponent } from './review/pano-card/pano-card';
import { StereoCardComponent } from './review/stereo-card/stereo-card';
import { AlbumManagerComponent } from './album-manager/album-manager';
import { DetectionLabComponent } from './detection/lab/detection-lab/detection-lab';
import { FullscreenViewerComponent } from './review/fullscreen-viewer/fullscreen-viewer';
import { SplashComponent, SplashState } from './splash/splash';
import { OnboardingComponent } from './onboarding/onboarding';
import { ReconnectComponent } from './reconnect/reconnect';
import { ReconnectPromptService } from './reconnect/reconnect-prompt.service';
import { HeadsUpComponent } from './notifications/heads-up/heads-up';
import { AlbumSetupNoticeComponent } from './notifications/album-setup-notice/album-setup-notice';
import { TagManagerComponent } from './tagging/tag-manager/tag-manager';
import { TagState } from './tagging/tag-state.service';
import { TagReviewService } from './tagging/tag-review.service';
import { TagReviewComponent } from './tagging/tag-review/tag-review';
import { SwipeDir } from './tagging/tags';
import { PreferencesService } from './preferences.service';
import { NavigationService } from './navigation.service';

// How many photos ahead of the current one to preload, so swiping never waits for an image.
const PREFETCH_AHEAD = 5;

// Minimum time the launch splash stays up before the app takes over, so the print finishes developing
// and the slogan is readable even when boot data loads faster than the animation. Covers the ~1s
// develop + wordmark reveal plus a beat to read "for the photos you'll keep".
const SPLASH_MIN_MS = 1800;

@Component({
  selector: 'app-root',
  imports: [
    ReviewSortComponent,
    ReviewAlbumTagsComponent,
    SessionDoneComponent,
    StreakFrozenNoticeComponent,
    ReviewEditComponent,
    PrintsComponent,
    SettingsComponent,
    BurstCardComponent,
    PanoCardComponent,
    StereoCardComponent,
    AlbumManagerComponent,
    DetectionLabComponent,
    FullscreenViewerComponent,
    SplashComponent,
    OnboardingComponent,
    ReconnectComponent,
    HeadsUpComponent,
    AlbumSetupNoticeComponent,
    TagManagerComponent,
    TagReviewComponent,
  ],
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './app.scss',
})
export class AppComponent implements OnInit, OnDestroy {
  private readonly svc = inject(LightroomService);
  private readonly previews = inject(PreviewCacheService);
  readonly feed = inject(ReviewFeedService); // public: the template reads feed.todayLabel
  private readonly catalogScan = inject(CatalogScanService);
  private readonly detectionSettings = inject(DetectionSettingsService);
  private readonly scan = inject(BackgroundScanService);
  // public: the template reads decisions.streakDays / .streakFreezes for the header chips
  readonly decisions = inject(ReviewDecisionsService);
  // public: the template reads its computeds directly (tallies, goal progress, edit queue)
  readonly stats = inject(ReviewStatsService);
  private readonly viewer = inject(FullscreenViewerService);
  private readonly tagState = inject(TagState);
  // public: the template reads canLoadMore off it for the Tag-more affordance
  readonly tagReview = inject(TagReviewService);
  // public: the template reads the goal settings straight off it
  readonly prefs = inject(PreferencesService);

  // The review decisions (verdicts + burst/pano corrections) live in ReviewDecisionsService; these

  // Persisted preferences live in PreferencesService; these are references to its signals so existing
  // reads/writes (and template bindings) keep working unchanged.
  readonly dailyGoal = this.prefs.dailyGoal;
  // Reminder prefs (morning/silent toggles + times) are now read and written directly by
  // SettingsComponent via PreferencesService — the host no longer relays them.
  readonly taggingEnabled = this.prefs.taggingEnabled;
  readonly tagDirections = this.prefs.tagDirections;
  // Album tags (vacation/stereo) are owned by AlbumManagerComponent directly via PreferencesService.
  readonly onboarded = this.prefs.onboarded;
  readonly deviceEnabled = this.prefs.deviceEnabled;
  readonly deviceFolders = this.prefs.deviceFolders;

  readonly loginHref = this.svc.loginHref();
  loading = signal(true);
  // When the splash first painted, so {@link revealAfterSplash} can hold it for at least SPLASH_MIN_MS.
  private readonly splashShownAt = performance.now();
  // What the launch splash communicates while loading. 'normal' is the only state wired to real boot
  // for now; 'offline'/'update'/'forced' are built out but await their triggers (no version endpoint
  // yet, and an offline mode that keeps a valid session needs its own auth-flow change).
  splashState = signal<SplashState>('normal');
  // Owned by LightroomService so that whatever ends a session — boot, an interceptor mid-swipe, a
  // disconnect from Settings — lowers this by the same act, and the app stops calling Lightroom.
  readonly authenticated = this.svc.connected;
  // public: the template swaps the whole shell for the reconnect screen while this is showing.
  readonly reconnect = inject(ReconnectPromptService);
  // True while a Lightroom token is being verified (after the OAuth redirect) — drives the golden
  // spinner on the onboarding connect button.
  connecting = signal(false);
  // Device source is "ready" (contributes photos / satisfies onboarding) only when it's on AND at
  // least one folder is selected.
  deviceReady = computed(() => this.deviceEnabled() && this.deviceFolders().some((f) => f.enabled));
  // Onboarding Continue unlocks once at least one source is set up.
  canContinueOnboarding = computed(() => this.authenticated() || this.deviceReady());
  // Developer detection lab, reached via the ?lab query param. Replaces the review UI when set.
  labMode = signal(false);
  // Which screen the app is on — plus the redirect a tapped reminder asks for — belongs to
  // NavigationService; these reference its signals so template bindings keep working unchanged.
  readonly nav = inject(NavigationService);
  readonly activeTab = this.nav.activeTab;
  readonly reviewMode = this.nav.reviewMode;
  // The Tag review step (cursor + its derived state + swipe/tag actions) lives in TagReviewService;
  // these reference its members so existing template bindings keep working unchanged.
  readonly tagReviewIndex = this.tagReview.cursor;
  readonly taggablePhotos = this.tagReview.taggablePhotos;
  // Album list (from the backend) + the ids the user has tagged as "vacation", and whether the
  // Manage-albums sub-screen is open. Vacation tags persist to localStorage like the other settings.
  albums = signal<Album[]>([]);
  readonly manageAlbumsOpen = this.nav.manageAlbumsOpen;
  // Content-tag catalog + assignments live in TagState; `tags` is referenced for template bindings.
  readonly tags = this.tagState.tags;
  readonly tagsManagerOpen = this.nav.tagsManagerOpen;
  error = signal<string | null>(null);
  // Burst-detection window in seconds (the persisted threshold lives in DetectionSettingsService).
  burstWindowSeconds = computed(() => this.detectionSettings.burstOptions().windowMs / 1000);

  // The review deck + its loading live in ReviewFeedService; these reference its signals so existing
  // reads/writes (decisions, computeds, template bindings) keep working unchanged.
  readonly reviewPhotos = this.feed.photos;
  readonly reviewIndex = this.feed.index;
  readonly photosLoaded = this.feed.loaded;
  readonly canLoadMore = this.feed.canLoadMore;
  // The full-screen viewer overlay (open/close state + the open/verdict flow) lives in
  // FullscreenViewerService; these reference its signals so the viewer's template bindings are unchanged.
  readonly fullscreenImages = this.viewer.images;
  readonly fullscreenReviewMode = this.viewer.reviewMode;
  readonly fullscreenStartIndex = this.viewer.startIndex;
  currentReviewPhoto = computed(() => this.reviewPhotos()[this.reviewIndex()]);
  // The current unit's preview URLs are derived by ReviewFeedService (it owns the cursor + the cache);
  // these reference its computeds so the cards' template bindings keep working unchanged.
  readonly currentReviewPhotoUrl = this.feed.currentUrl;
  readonly currentUnitImageUrls = this.feed.currentUnitUrls;
  // The deck's derived stats (tallies, goal progress, Edit/Print queues) live in ReviewStatsService;
  // these reference its computeds so the template bindings keep working unchanged.
  readonly editBatch = this.stats.editBatch;
  // Frame-id → preview URL for today's edit batch, so the Edit list can show each photo (read
  // reactively so a thumbnail appears as its preview finishes loading). The Prints tab's own component
  // reads previews directly; the host only warms its photos (see prefetchWindow).
  readonly editImageUrls = computed(() => this.previewUrlsFor(this.editBatch()));
  // Debounce handle: the goal slider emits continuously, so we resample once it settles.
  private goalResampleTimer: ReturnType<typeof setTimeout> | null = null;
  // Debounce handle for the burst-window slider, which forces a (heavy) library re-scan on change.
  private burstRescanTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // The decisions service refills the background-scan buffer after each verdict; let it re-check the
    // live session at fire time (a disconnect mid-debounce should cancel the scan).
    this.decisions.bindAuth(this.authenticated);

    // Keep the current unit's previews plus the next PREFETCH_AHEAD ones loaded, so swiping never
    // waits, and evict anything outside that window (we only ever move forward). Warms every frame id
    // of each unit — a single photo, or all the frames of a burst/pano/stereo. Guarded by
    // photosLoaded so the mock fallback (whose ids aren't real assets) is skipped.
    effect(() => {
      if (!this.photosLoaded()) return;
      if (this.activeTab() === 'prints') return; // the Prints tab warms its own (visible) previews
      const windowIds = new Set<string>();
      for (const item of this.prefetchWindow()) {
        if (isDevicePhoto(item)) continue; // device photos have no Lightroom rendition to warm
        for (const id of unitAssetIds(item)) {
          windowIds.add(id);
          void this.previews.ensure(id);
        }
      }
      this.previews.evictOutside(windowIds);
    });
  }

  // The units whose previews to keep loaded: the (small) edit batch in Edit mode; the keepers around
  // the tag cursor in Tag mode; otherwise the sort feed around the review cursor. (The Prints tab warms
  // its own previews — see the effect above.)
  private prefetchWindow(): ReviewItem[] {
    if (this.reviewMode() === 'edit') return this.editBatch();
    const tagMode = this.reviewMode() === 'tag';
    const photos = tagMode ? this.taggablePhotos() : this.reviewPhotos();
    const start = tagMode ? this.tagReviewIndex() : this.reviewIndex();
    return photos.slice(start, start + PREFETCH_AHEAD + 1);
  }

  // Builds an id → preview-URL map for a set of photos, reading the in-memory cache reactively so a
  // thumbnail appears as its preview finishes loading.
  private previewUrlsFor(photos: Photo[]): Map<string, SafeUrl> {
    const urls = new Map<string, SafeUrl>();
    for (const photo of photos) {
      const url = this.previews.url(photo.id);
      if (url) urls.set(photo.id, url);
    }
    return urls;
  }

  ngOnInit(): void {
    // Persisted preferences are loaded by PreferencesService on construction; just kick off the rest.
    void this.tagState.refresh(); // load the content-tag catalog (seeds defaults on first run)
    void this.init();
  }

  /** Settings → Tags: add / rename / delete a content tag (delegated to TagState). */
  addTag(name: string): void {
    void this.tagState.add(name);
  }

  renameTag(change: { id: string; name: string }): void {
    void this.tagState.rename(change.id, change.name);
  }

  removeTag(id: string): void {
    void this.tagState.remove(id);
  }

  private async init(): Promise<void> {
    const params = new URLSearchParams(window.location.search);
    this.labMode.set(params.has('lab'));
    const authError = params.get('auth_error');

    // After login the backend redirects with the tokens in the URL fragment; capture them.
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const accessToken = hash.get('access_token');
    const refreshToken = hash.get('refresh_token');

    // Coming back from an OAuth round-trip (tokens or an error in the URL) is not a cold start — skip
    // the launch splash and land straight on onboarding, where the Lightroom card shows the spinner /
    // checkmark for what just happened.
    const returningFromLogin = !!authError || !!(accessToken && refreshToken);
    if (returningFromLogin) this.loading.set(false);

    if (authError) {
      const detail = params.get('detail');
      this.error.set(`Login failed: ${authError}${detail ? ' — ' + detail : ''}`);
      window.history.replaceState({}, '', window.location.pathname);
      return;
    }

    if (accessToken && refreshToken) {
      this.svc.setTokens(accessToken, refreshToken);
      window.history.replaceState({}, '', window.location.pathname);
    }

    if (await this.verifyAndLoadSession(returningFromLogin)) return; // lab took over the screen

    // Device-only returning user (onboarded, no Lightroom session): the deck is just device photos.
    if (!this.authenticated() && this.onboarded()) {
      this.reviewPhotos.set([]); // drop the design-time mock fallback
      await this.feed.refreshDeviceDeck();
    }
    if (!returningFromLogin) await this.revealAfterSplash();
  }

  // Validates the stored Lightroom token (showing the connect spinner meanwhile) and, on success,
  // loads the review session. Returns true only when it has fully taken over the screen (lab mode),
  // signalling init to stop. A failure leaves the user on onboarding, or — if this device had a
  // session that is now gone — on the reconnect screen asking them to sign in to Adobe again.
  private async verifyAndLoadSession(returningFromLogin: boolean): Promise<boolean> {
    if (!this.svc.resumeSession()) return false;
    this.connecting.set(true); // golden spinner on the onboarding connect button until this resolves
    try {
      // Fetching the catalog id both caches it and validates the token (refreshing if expired).
      await firstValueFrom(this.svc.loadCatalogId());
    } catch (err) {
      this.endSession(err, returningFromLogin);
      return false;
    }
    this.authenticated.set(true);
    this.connecting.set(false);
    if (this.labMode()) {
      this.loading.set(false);
      return true; // the lab loads its own data; skip the review pipeline entirely
    }
    // Deliberately outside the check above: failing to load content says nothing about the
    // credentials, so a backend still coming back up must not cost the Lightroom session.
    try {
      await this.loadPhotos();
      await this.loadAlbums();
    } catch {
      this.error.set('Could not load your photos — check your connection and try again.');
    }
    void this.scan.run(this.authenticated); // populate detection stores for future sessions
    return false;
  }

  // Only a genuine auth failure costs the stored tokens. Anything else — the Pi restarting after a
  // deploy, a dropped connection — leaves them alone: signing in to Adobe again fixes nothing when
  // the credentials were never the problem.
  private endSession(err: unknown, returningFromLogin: boolean): void {
    this.connecting.set(false);
    if (!isAuthFailure(err)) {
      this.error.set('Could not reach Lightroom — check your connection and try again.');
      return;
    }
    this.svc.loseSession();
    if (returningFromLogin) this.error.set('Could not connect to Lightroom — please try again.');
  }

  /**
   * Hands the screen from the splash to the app, but never before SPLASH_MIN_MS has passed — so the
   * print finishes developing and the slogan is readable even when boot data arrives sooner. Skipped
   * for a non-normal notice (offline/update/forced), which waits on the user instead.
   */
  private async revealAfterSplash(): Promise<void> {
    if (this.splashState() !== 'normal') return;
    const remaining = SPLASH_MIN_MS - (performance.now() - this.splashShownAt);
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
    this.loading.set(false);
  }

  /** Splash "Continue"/"Later" — dismiss a non-blocking notice and fall through to the loaded app. */
  continueFromSplash(): void {
    this.splashState.set('normal');
    this.loading.set(false);
  }

  /** Splash "Update" — would open the store / trigger the update once that path exists. */
  requestSplashUpdate(): void {
    // No update channel yet; wired so the button is live the moment one lands.
  }

  /** Onboarding "Continue" — record setup as done and enter the app with the chosen sources. */
  async completeOnboarding(): Promise<void> {
    this.onboarded.set(true);
    // An authenticated user already had loadPhotos build the deck during init; a device-only user
    // starts from an empty base. Either way, reconcile device photos against the final settings.
    if (!this.authenticated()) this.reviewPhotos.set([]);
    await this.feed.refreshDeviceDeck();
  }

  /** Flip the master "review photos from this device" toggle, then re-sync the deck. */
  toggleDevice(enabled: boolean): void {
    this.deviceEnabled.set(enabled);
    void this.feed.refreshDeviceDeck();
  }

  /** Toggle one device folder's inclusion, then re-sync the deck. */
  toggleDeviceFolder(name: string): void {
    this.deviceFolders.update((folders) =>
      folders.map((f) => (f.name === name ? { ...f, enabled: !f.enabled } : f)),
    );
    void this.feed.refreshDeviceDeck();
  }

  private async loadAlbums(): Promise<void> {
    try {
      this.albums.set(await firstValueFrom(this.svc.getAlbums()));
    } catch {
      // Leave the album list empty; the Manage-albums screen will show "No albums match".
    }
  }

  // Loads today's review deck via ReviewFeedService, surfacing any failure as a user-visible error.
  private async loadPhotos(): Promise<void> {
    try {
      await this.feed.loadToday();
    } catch (e: unknown) {
      this.error.set(
        'Could not load photos: ' + (e instanceof Error ? e.message : 'unknown error'),
      );
    }
  }

  // Chooses today's/tomorrow's review queue on-device from the scanned metadata + detected groups,
  // so a burst arrives as one unit. Falls back to the server sample on cold start, before the first
  // background scan has populated storage.
  // Updates the daily goal and rebuilds today's + tomorrow's selection to the new size. Debounced,
  // since the slider emits on every drag tick; only the settled value triggers a resample.
  setDailyGoal(goal: number): void {
    if (goal === this.dailyGoal()) return;
    this.dailyGoal.set(goal);
    if (!this.authenticated()) return;
    if (this.goalResampleTimer) clearTimeout(this.goalResampleTimer);
    this.goalResampleTimer = setTimeout(() => void this.resampleDailyFeed(), 500);
  }

  // Discards the cached today/tomorrow selections and rebuilds them at the current goal. Stored
  // verdicts are re-applied on reload, so decisions for photos that survive the new sample persist.
  private async resampleDailyFeed(): Promise<void> {
    await this.feed.clearDailySelections();
    await this.loadPhotos(); // app wrapper surfaces any load error
  }

  // Updates the burst-detection window (seconds) and, debounced, re-detects the whole library at the
  // new threshold. Heavy by design — the Settings UI warns about it. The manifest gate keys on album
  // *content*, so a threshold change alone wouldn't re-detect anything without clearing it.
  setBurstWindowSeconds(seconds: number): void {
    const windowMs = Math.round(seconds) * 1000;
    if (windowMs === this.detectionSettings.burstOptions().windowMs) return;
    this.detectionSettings.setBurstOptions({ windowMs });
    if (!this.authenticated()) return;
    if (this.burstRescanTimer) clearTimeout(this.burstRescanTimer);
    this.burstRescanTimer = setTimeout(() => void this.rescanForDetectionChange(), 800);
  }

  private async rescanForDetectionChange(): Promise<void> {
    await this.catalogScan.rescanAllForcingRedetection();
    await this.resampleDailyFeed();
  }

  /** "Review more" — pull a fresh batch of unseen units (delegated to ReviewFeedService). */
  loadMore(): Promise<void> {
    return this.feed.loadMore();
  }

  /** The Lightroom catalog id, for the Edit list's "Open in Lightroom" deep-links (null until authed). */
  catalogId(): string | null {
    return this.svc.getCatalogId();
  }

  /** Open the current single photo full screen with verdict buttons (delegated to FullscreenViewerService). */
  openPhotoFullscreen(): void {
    this.viewer.openPhoto();
  }

  /** Open the current burst's frames as an A/B compare (delegated). The cards' URL map is passed through. */
  openBurstCompare(event: { ids: string[]; start: number }): void {
    this.viewer.openBurstCompare(event, this.currentUnitImageUrls());
  }

  /** A verdict from the viewer's buttons (delegated). */
  fullscreenVerdict(verdict: 'kept' | 'rejected' | 'toEdit' | 'maybe'): void {
    this.viewer.verdict(verdict);
  }

  closeFullscreen(): void {
    this.viewer.close();
  }

  /** Swipe verdict on the current unit (delegated to ReviewDecisionsService). */
  decide(verdict: 'kept' | 'rejected' | 'toEdit' | 'maybe'): void {
    this.decisions.decide(verdict);
  }

  /** Persist which twin-DSLR body is the left eye for this stereo album (keyed by name, like stereo). */
  swapStereoEyes(e: { albumName: string | null; leftSerial: string }): void {
    if (!e.albumName) return;
    const albumName = e.albumName;
    this.prefs.stereoLeftSerial.update((m) => ({ ...m, [albumName]: e.leftSerial }));
  }

  toggleStar(): void {
    this.decisions.toggleStar();
  }

  toggleKeepsake(): void {
    this.decisions.toggleKeepsake();
  }

  /** Settings toggle for the optional Tag step. Turning it off while in Tag mode falls back to Sort. */
  setTaggingEnabled(enabled: boolean): void {
    this.taggingEnabled.set(enabled);
    this.nav.leaveTagModeIfDisabled();
  }

  /** Swipe in Tag mode: apply the direction's bound tag and advance (delegated to TagReviewService). */
  loadMoreTags(): void {
    void this.tagReview.loadMore();
  }

  swipeTag(dir: SwipeDir): void {
    this.tagReview.swipe(dir);
  }

  /** Bind (or clear) a swipe direction to a tag (delegated). */
  setTagDirection(change: { dir: SwipeDir; tagId: string | null }): void {
    this.tagReview.setDirection(change);
  }

  /** Apply or remove a tag on the current Tag-step photo (delegated). */
  toggleTag(tagId: string): void {
    this.tagReview.toggle(tagId);
  }

  nextTagPhoto(): void {
    this.tagReview.next();
  }

  prevTagPhoto(): void {
    this.tagReview.prev();
  }

  /** The burst's outcome: the frames to keep (everything else in it is rejected). Delegated. */
  resolveBurst(keptIds: string[]): void {
    this.decisions.resolveBurst(keptIds);
  }

  rejectBurst(): void {
    this.decisions.rejectBurst();
  }

  /** "This is actually a pano" — relabel the current burst (delegated). */
  markBurstAsPano(): void {
    this.decisions.markBurstAsPano();
  }

  /** "This is actually a burst" — relabel the current pano (delegated). */
  markPanoAsBurst(): void {
    this.decisions.markPanoAsBurst();
  }

  /** "Photos are missing" — the frames the current pano should have (delegated). */
  setPanoFrames(frames: PanoFrame[]): void {
    this.decisions.setPanoFrames(frames);
  }

  promoteToPrint(id: string): void {
    this.decisions.promoteToPrint(id);
  }

  // Disconnects the Lightroom source from Settings: revokes the token (best-effort) and drops its
  // photos from the deck, but stays in the app — the user keeps their device source and can reconnect
  // any time from the same card. Not a full sign-out; onboarding is not re-shown.
  async disconnectLightroom(): Promise<void> {
    try {
      await firstValueFrom(this.svc.logout());
    } catch {
      /* ignore — disconnect locally regardless of the backend call */
    }
    this.svc.forgetSession();
    this.connecting.set(false);
    this.photosLoaded.set(false);
    this.previews.revokeAll();
    this.reviewPhotos.set([]); // drop Lightroom photos; device photos (if any) are re-added below
    await this.feed.refreshDeviceDeck();
  }

  ngOnDestroy(): void {
    this.previews.revokeAll();
    this.scan.dispose();
    if (this.goalResampleTimer) clearTimeout(this.goalResampleTimer);
    if (this.burstRescanTimer) clearTimeout(this.burstRescanTimer);
  }
}
