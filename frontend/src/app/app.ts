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
import { Album, LightroomService, PhotoAsset } from './lightroom.service';
import { ReviewStore } from './storage/review/review-store';
import { PreviewCacheService } from './review/preview-cache.service';
import { StoredVerdict, Tag } from './storage/photokeeper-db';
import { DailyUnitsService } from './review/selection/daily-units.service';
import { CatalogScanService } from './detection/catalog-scan.service';
import { DetectionSettingsService } from './detection/detection-settings.service';
import { AlbumManifestStore } from './storage/detection/album-manifest-store';
import { AssetMetaStore } from './storage/review/asset-meta-store';
import {
  Burst,
  BurstPhoto,
  DeviceFolder,
  Pano,
  Photo,
  ReviewItem,
  DEVICE_FOLDERS,
  DEVICE_PHOTOS,
  MOCK_PHOTOS,
  MOCK_BURST,
  MOCK_PANO,
  MOCK_STEREO,
  splitFileName,
} from './photo';
import { GroupOverrideStore } from './storage/detection/group-override-store';
import { ReviewSortComponent } from './review/review-sort/review-sort';
import { SessionDoneComponent } from './review/session-done/session-done';
import { ReviewEditComponent } from './review/review-edit/review-edit';
import { PipelineComponent } from './pipeline/pipeline';
import { SettingsComponent } from './settings/settings';
import { BurstCardComponent } from './review/burst-card/burst-card';
import { PanoCardComponent } from './review/pano-card/pano-card';
import { StereoCardComponent } from './review/stereo-card/stereo-card';
import { AlbumManagerComponent } from './album-manager/album-manager';
import { DetectionLabComponent } from './detection/detection-lab/detection-lab';
import {
  FullscreenViewerComponent,
  ViewerImage,
} from './review/fullscreen-viewer/fullscreen-viewer';
import { SplashComponent, SplashState } from './splash/splash';
import { OnboardingComponent } from './onboarding/onboarding';
import { HeadsUpComponent, HeadsUp } from './notifications/heads-up/heads-up';
import { TagManagerComponent } from './tagging/tag-manager/tag-manager';
import { TagStore } from './storage/tags/tag-store';
import { AssetTagStore } from './storage/tags/asset-tag-store';
import { TagReviewComponent } from './tagging/tag-review/tag-review';
import { DEFAULT_TAG_DIRECTIONS, SWIPE_DIRS, SwipeDir, TagDirections } from './tagging/tags';

// How many photos ahead of the current one to preload, so swiping never waits for an image.
const PREFETCH_AHEAD = 5;

// Minimum time the launch splash stays up before the app takes over, so the print finishes developing
// and the slogan is readable even when boot data loads faster than the animation. Covers the ~1s
// develop + wordmark reveal plus a beat to read "for the photos you'll keep".
const SPLASH_MIN_MS = 1800;

// Target size of the "scanned but not yet reviewed" buffer the background detection scan maintains.
// Each pass tops the buffer back up to this; as the user reviews and it falls under, the app refills.
const SCAN_BUFFER_TARGET = 100;

// Debounce before a review-triggered scan refill, so a flurry of swipes coalesces into one pass.
const SCAN_REFILL_DEBOUNCE_MS = 4000;

// Local-date key (YYYY-MM-DD) used to scope the daily selection — local so it doesn't flip a day
// early/late at UTC midnight.
function dateKey(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

function todayKey(): string {
  return dateKey(new Date());
}

/** Reads + parses a JSON localStorage value, or null if absent/corrupt. */
function readJson(key: string): unknown {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function tomorrowKey(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return dateKey(d);
}

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

/** Re-types a burst as a (horizontal) pano in place, keeping its frames, album, time and status. */
function burstToPano(burst: Burst): Pano {
  return {
    id: `pano:${burst.id}`,
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
    id: `burst:${pano.id}`,
    name: `Burst · ${pano.frames.length} frames`,
    album: pano.album,
    taken: pano.taken,
    status: pano.status,
    kind: 'burst',
    photos: pano.frames.map((f) => ({ id: f.id, name: f.name, blur: f.blur })),
  };
}

/** A single photo pulled from a local device folder (no Lightroom rendition to fetch). */
function isDevicePhoto(item: ReviewItem): boolean {
  return item.kind === 'photo' && item.source === 'device';
}

/** Every real asset id a review unit references — its own, or all the frames of a group. */
function unitAssetIds(item: ReviewItem): string[] {
  switch (item.kind) {
    case 'photo':
      return [item.id];
    case 'burst':
      return item.photos.map((p) => p.id);
    case 'pano':
      return item.frames.map((f) => f.id);
    case 'stereo':
      return [...item.left, ...item.baselines.flatMap((b) => b.frames)].map((f) => f.id);
  }
}

@Component({
  selector: 'app-root',
  imports: [
    ReviewSortComponent,
    SessionDoneComponent,
    ReviewEditComponent,
    PipelineComponent,
    SettingsComponent,
    BurstCardComponent,
    PanoCardComponent,
    StereoCardComponent,
    AlbumManagerComponent,
    DetectionLabComponent,
    FullscreenViewerComponent,
    SplashComponent,
    OnboardingComponent,
    HeadsUpComponent,
    TagManagerComponent,
    TagReviewComponent,
  ],
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './app.scss',
})
export class AppComponent implements OnInit, OnDestroy {
  private readonly svc = inject(LightroomService);
  private readonly reviewStore = inject(ReviewStore);
  private readonly previews = inject(PreviewCacheService);
  private readonly dailyUnits = inject(DailyUnitsService);
  private readonly catalogScan = inject(CatalogScanService);
  private readonly detectionSettings = inject(DetectionSettingsService);
  private readonly albumManifests = inject(AlbumManifestStore);
  private readonly meta = inject(AssetMetaStore);
  private readonly groupOverrides = inject(GroupOverrideStore);
  private readonly tagStore = inject(TagStore);
  private readonly assetTags = inject(AssetTagStore);

  readonly loginHref = this.svc.loginHref();
  loading = signal(true);
  // When the splash first painted, so {@link revealAfterSplash} can hold it for at least SPLASH_MIN_MS.
  private readonly splashShownAt = performance.now();
  // What the launch splash communicates while loading. 'normal' is the only state wired to real boot
  // for now; 'offline'/'update'/'forced' are built out but await their triggers (no version endpoint
  // yet, and an offline mode that keeps a valid session needs its own auth-flow change).
  splashState = signal<SplashState>('normal');
  authenticated = signal(false);
  // First-run setup is done (Lightroom connected and/or this device accepted). Until then the
  // onboarding screen shows instead of the app. Persisted so it's a true first-run-only gate.
  onboarded = signal(false);
  // True while a Lightroom token is being verified (after the OAuth redirect) — drives the golden
  // spinner on the onboarding connect button.
  connecting = signal(false);
  // "This device" photo source: a master toggle plus which local folders to include. Mock data in the
  // web PoC (see DEVICE_FOLDERS); persisted to localStorage like the other settings.
  deviceEnabled = signal(false);
  deviceFolders = signal<DeviceFolder[]>(DEVICE_FOLDERS.map((f) => ({ ...f })));
  // Device source is "ready" (contributes photos / satisfies onboarding) only when it's on AND at
  // least one folder is selected.
  deviceReady = computed(() => this.deviceEnabled() && this.deviceFolders().some((f) => f.enabled));
  // Onboarding Continue unlocks once at least one source is set up.
  canContinueOnboarding = computed(() => this.authenticated() || this.deviceReady());
  // Developer detection lab, reached via the ?lab query param. Replaces the review UI when set.
  labMode = signal(false);
  activeTab = signal<'review' | 'pipeline' | 'settings'>('review');
  reviewMode = signal<'sort' | 'edit' | 'tag'>('sort');
  reviewIndex = signal(0);
  // Tag review (optional, off by default): a third review mode that labels already-sorted keepers.
  taggingEnabled = signal(false);
  tagReviewIndex = signal(0);
  // Daily tagging goal — same scale as sorting (quick, not intensive like editing).
  tagGoal = signal(15);
  // Which tag each swipe direction applies in Tag mode (reassignable in Settings → Tags).
  tagDirections = signal<TagDirections>({ ...DEFAULT_TAG_DIRECTIONS });
  // assetId → applied tag ids, loaded from the assignment store and updated as you tag.
  private readonly tagAssignments = signal<Record<string, string[]>>({});
  // Album list (from the backend) + the ids the user has tagged as "vacation", and whether the
  // Manage-albums sub-screen is open. Vacation tags persist to localStorage like the other settings.
  albums = signal<Album[]>([]);
  vacationAlbumIds = signal<string[]>([]);
  manageAlbumsOpen = signal(false);
  // User-defined content tags (Animals, Family…) and whether the Tags sub-screen is open.
  tags = signal<Tag[]>([]);
  tagsManagerOpen = signal(false);
  error = signal<string | null>(null);
  dailyGoal = signal(15);
  // Burst-detection window in seconds (the persisted threshold lives in DetectionSettingsService).
  burstWindowSeconds = computed(() => this.detectionSettings.burstOptions().windowMs / 1000);
  editGoal = signal(3);
  editedToday = signal(0);
  // The current in-app celebration heads-up (or null). Celebrations only — earned, in-the-moment wins.
  celebration = signal<HeadsUp | null>(null);
  morningReminder = signal(true);
  reminderTime = signal('09:00');
  silentTime = signal('21:00');
  silentEvening = signal(true);

  // Lightroom photos replace the mock list once they load; until then the mock data acts as a
  // fallback so the UI still works offline / before auth.
  reviewPhotos = signal<ReviewItem[]>([...MOCK_PHOTOS, MOCK_BURST, MOCK_PANO, MOCK_STEREO]);
  photosLoaded = signal(false);
  // Whether "Review more" can still pull fresh photos; false once the population is exhausted.
  canLoadMore = signal(true);
  // Images shown in the full-screen viewer, or null when it's closed.
  fullscreenImages = signal<ViewerImage[] | null>(null);
  // Single-photo (review) mode shows verdict buttons in the viewer; burst compare shows A/B switching.
  fullscreenReviewMode = signal(false);
  // Which frame the viewer opens on (the tapped one, for burst compare).
  fullscreenStartIndex = signal(0);
  currentReviewPhoto = computed(() => this.reviewPhotos()[this.reviewIndex()]);
  // Preview URLs come from PreviewCacheService (the in-memory window cache); these computeds read it
  // reactively so the cards re-render as previews arrive.
  currentReviewPhotoUrl = computed(() => {
    const current = this.currentReviewPhoto();
    return current?.kind === 'photo' ? this.previews.url(current.id) : null;
  });
  // Frame-id → preview URL for the current unit (e.g. a burst's frames), passed to the group cards.
  currentUnitImageUrls = computed(() => {
    const current = this.currentReviewPhoto();
    const urls = new Map<string, SafeUrl>();
    for (const id of current ? unitAssetIds(current) : []) {
      const url = this.previews.url(id);
      if (url) urls.set(id, url);
    }
    return urls;
  });
  doneToday = computed(() => this.reviewPhotos().filter((p) => p.status !== 'backlog').length);
  sessionDone = computed(() => this.doneToday() === this.reviewPhotos().length);
  // The Tag-step pool: single photos already sorted into a keeper status (not backlog, not rejected).
  taggablePhotos = computed(() =>
    this.reviewPhotos().filter(
      (p): p is Photo => p.kind === 'photo' && p.status !== 'backlog' && p.status !== 'rejected',
    ),
  );
  currentTagPhoto = computed(() => this.taggablePhotos()[this.tagReviewIndex()]);
  // The current Tag-step photo's preview, and the tag ids applied to it.
  currentTagPhotoUrl = computed(() => {
    const photo = this.currentTagPhoto();
    return photo ? this.previews.url(photo.id) : null;
  });
  currentTagPhotoTagIds = computed(() => {
    const photo = this.currentTagPhoto();
    return photo ? (this.tagAssignments()[photo.id] ?? []) : [];
  });
  // How many keepers have at least one tag — the Tag-mode progress against the tagging goal.
  taggedCount = computed(
    () =>
      this.taggablePhotos().filter((p) => (this.tagAssignments()[p.id]?.length ?? 0) > 0).length,
  );
  progressTagPercent = computed(() => Math.min(100, (this.taggedCount() / this.tagGoal()) * 100));
  keptCount = computed(() => this.reviewPhotos().filter((p) => p.status === 'kept').length);
  rejectedCount = computed(() => this.reviewPhotos().filter((p) => p.status === 'rejected').length);
  toEditCount = computed(() => this.reviewPhotos().filter((p) => p.status === 'toEdit').length);
  maybeCount = computed(() => this.reviewPhotos().filter((p) => p.status === 'maybe').length);
  progressReviewPercent = computed(() =>
    Math.min(100, (this.doneToday() / this.dailyGoal()) * 100),
  );
  progressEditPercent = computed(() => Math.min(100, (this.editedToday() / this.editGoal()) * 100));
  toEditQueue = computed(() =>
    this.reviewPhotos().filter((p): p is Photo => p.kind === 'photo' && p.status === 'toEdit'),
  );
  editDone = computed(
    () => this.editedToday() >= this.editGoal() || this.toEditQueue().length === 0,
  );
  toPrintQueue = computed(() =>
    this.reviewPhotos().filter((p): p is Photo => p.kind === 'photo' && p.status === 'toPrint'),
  );
  toEditByAlbum = computed(() => this.groupByAlbum(this.toEditQueue()));
  toPrintByAlbum = computed(() => this.groupByAlbum(this.toPrintQueue()));
  // Debounce handle: the goal slider emits continuously, so we resample once it settles.
  private goalResampleTimer: ReturnType<typeof setTimeout> | null = null;
  // Debounce handle for the burst-window slider, which forces a (heavy) library re-scan on change.
  private burstRescanTimer: ReturnType<typeof setTimeout> | null = null;
  // Debounce handle for the review-triggered scan refill.
  private scanRefillTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      localStorage.setItem('dailyGoal', String(this.dailyGoal()));
      localStorage.setItem('editGoal', String(this.editGoal()));
      localStorage.setItem('tagGoal', String(this.tagGoal()));
      localStorage.setItem('morningReminder', String(this.morningReminder()));
      localStorage.setItem('reminderTime', this.reminderTime());
      localStorage.setItem('silentTime', this.silentTime());
      localStorage.setItem('silentEvening', String(this.silentEvening()));
      localStorage.setItem('taggingEnabled', String(this.taggingEnabled()));
      localStorage.setItem('tagDirections', JSON.stringify(this.tagDirections()));
      localStorage.setItem('vacationAlbumIds', JSON.stringify(this.vacationAlbumIds()));
      localStorage.setItem('onboarded', String(this.onboarded()));
      localStorage.setItem('deviceEnabled', String(this.deviceEnabled()));
      // Persist only the per-folder enabled flags by name, so changing the folder catalogue later
      // doesn't strand stale entries.
      const enabledFolders = this.deviceFolders()
        .filter((f) => f.enabled)
        .map((f) => f.name);
      localStorage.setItem('deviceFolders', JSON.stringify(enabledFolders));
    });

    // Keep the current unit's previews plus the next PREFETCH_AHEAD ones loaded, so swiping never
    // waits, and evict anything outside that window (we only ever move forward). Warms every frame id
    // of each unit — a single photo, or all the frames of a burst/pano/stereo. Guarded by
    // photosLoaded so the mock fallback (whose ids aren't real assets) is skipped.
    effect(() => {
      if (!this.photosLoaded()) return;
      // In the Tag step the cursor runs over the keepers pool, not the sort feed — warm around that
      // so the photo you're tagging is already loaded.
      const tagMode = this.reviewMode() === 'tag';
      const photos = tagMode ? this.taggablePhotos() : this.reviewPhotos();
      const start = tagMode ? this.tagReviewIndex() : this.reviewIndex();
      const windowIds = new Set<string>();
      for (let i = 0; i <= PREFETCH_AHEAD; i++) {
        const item = photos[start + i];
        if (!item) continue;
        if (isDevicePhoto(item)) continue; // device photos have no Lightroom rendition to warm
        for (const id of unitAssetIds(item)) {
          windowIds.add(id);
          void this.previews.ensure(id);
        }
      }
      this.previews.evictOutside(windowIds);
    });
  }

  ngOnInit(): void {
    const savedDailyGoal = localStorage.getItem('dailyGoal');
    if (savedDailyGoal) this.dailyGoal.set(Number(savedDailyGoal));
    const savedTagGoal = localStorage.getItem('tagGoal');
    if (savedTagGoal) this.tagGoal.set(Number(savedTagGoal));
    const savedEditGoal = localStorage.getItem('editGoal');
    if (savedEditGoal) this.editGoal.set(Number(savedEditGoal));
    const savedMorningReminder = localStorage.getItem('morningReminder');
    if (savedMorningReminder) this.morningReminder.set(savedMorningReminder === 'true');
    const savedReminderTime = localStorage.getItem('reminderTime');
    if (savedReminderTime) this.reminderTime.set(savedReminderTime);
    const savedSilentTime = localStorage.getItem('silentTime');
    if (savedSilentTime) this.silentTime.set(savedSilentTime);
    const savedSilentEvening = localStorage.getItem('silentEvening');
    if (savedSilentEvening) this.silentEvening.set(savedSilentEvening === 'true');
    this.taggingEnabled.set(localStorage.getItem('taggingEnabled') === 'true');
    this.onboarded.set(localStorage.getItem('onboarded') === 'true');
    this.deviceEnabled.set(localStorage.getItem('deviceEnabled') === 'true');
    this.restoreJsonSettings();
    void this.refreshTags(); // load the content-tag catalog (seeds defaults on first run)
    void this.init();
  }

  /** Restores the JSON-encoded settings (tag directions, vacation ids, device folders) from storage. */
  private restoreJsonSettings(): void {
    const dirs: unknown = readJson('tagDirections');
    if (dirs && typeof dirs === 'object') this.tagDirections.set(dirs);

    const vacation: unknown = readJson('vacationAlbumIds');
    if (Array.isArray(vacation)) {
      this.vacationAlbumIds.set(vacation.filter((id): id is string => typeof id === 'string'));
    }

    const folders: unknown = readJson('deviceFolders');
    if (Array.isArray(folders)) {
      const on = new Set(folders.filter((n): n is string => typeof n === 'string'));
      this.deviceFolders.update((list) => list.map((f) => ({ ...f, enabled: on.has(f.name) })));
    }
  }

  /**
   * Reloads the content-tag catalog and per-photo assignments — independently, so a failure loading
   * one never hides the other (and so an error is visible rather than silently swallowed).
   */
  private async refreshTags(): Promise<void> {
    try {
      this.tags.set(await this.tagStore.getAll());
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Tag catalog failed to load', e);
    }
    try {
      this.tagAssignments.set(await this.assetTags.getAll());
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Tag assignments failed to load', e);
    }
  }

  /** Settings → Tags: add a new content tag (de-duplicated by name in the store), then refresh. */
  async addTag(name: string): Promise<void> {
    await this.tagStore.add(name);
    await this.refreshTags();
  }

  /** Rename a content tag in place. */
  async renameTag(change: { id: string; name: string }): Promise<void> {
    await this.tagStore.rename(change.id, change.name);
    await this.refreshTags();
  }

  /** Delete a content tag from the catalog (a removed default stays removed). */
  async removeTag(id: string): Promise<void> {
    await this.tagStore.remove(id);
    await this.refreshTags();
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
      await this.refreshDeviceDeck();
    }
    if (!returningFromLogin) await this.revealAfterSplash();
  }

  // Validates the stored Lightroom token (showing the connect spinner meanwhile) and, on success,
  // loads the review session. Returns true only when it has fully taken over the screen (lab mode),
  // signalling init to stop. A missing token or a failure leaves the user on onboarding.
  private async verifyAndLoadSession(returningFromLogin: boolean): Promise<boolean> {
    if (!this.svc.getAccessToken()) return false;
    this.connecting.set(true); // golden spinner on the onboarding connect button until this resolves
    try {
      // Fetching the catalog id both caches it and validates the token (refreshing if expired).
      await firstValueFrom(this.svc.loadCatalogId());
      this.authenticated.set(true);
      this.connecting.set(false);
      if (this.labMode()) {
        this.loading.set(false);
        return true; // the lab loads its own data; skip the review pipeline entirely
      }
      await this.loadPhotos();
      await this.loadAlbums();
      void this.precomputeTomorrow(); // warm tomorrow ahead; never blocks first paint
      void this.runBackgroundScan(); // populate detection stores for future sessions
    } catch {
      // Token couldn't be validated/refreshed — fall back to onboarding.
      this.svc.clearTokens();
      this.authenticated.set(false);
      this.connecting.set(false);
      if (returningFromLogin) this.error.set('Could not connect to Lightroom — please try again.');
    }
    return false;
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

  /** The enabled-folder device photos that should be in the deck right now (empty if device is off). */
  private deviceDeck(): Photo[] {
    if (!this.deviceReady()) return [];
    const on = new Set(
      this.deviceFolders()
        .filter((f) => f.enabled)
        .map((f) => f.name),
    );
    return DEVICE_PHOTOS.filter((p) => p.album && on.has(p.album));
  }

  // Reconciles the device photos in the deck with the current device settings: strips the existing
  // device photos and re-appends the ones the settings now call for, with stored verdicts overlaid so
  // swipes survive. Keeps Lightroom photos and the review index intact.
  private async refreshDeviceDeck(): Promise<void> {
    const verdicts = await this.reviewStore.getVerdicts();
    const base = this.reviewPhotos().filter((p) => !isDevicePhoto(p));
    const device = this.deviceDeck().map((p) => this.applyVerdict(p, verdicts.get(p.id)));
    const deck = [...base, ...device];
    this.reviewPhotos.set(deck);
    if (this.reviewIndex() >= deck.length) this.reviewIndex.set(Math.max(0, deck.length - 1));
  }

  /** Onboarding "Continue" — record setup as done and enter the app with the chosen sources. */
  async completeOnboarding(): Promise<void> {
    this.onboarded.set(true);
    // An authenticated user already had loadPhotos build the deck during init; a device-only user
    // starts from an empty base. Either way, reconcile device photos against the final settings.
    if (!this.authenticated()) this.reviewPhotos.set([]);
    await this.refreshDeviceDeck();
  }

  /** Flip the master "review photos from this device" toggle, then re-sync the deck. */
  toggleDevice(enabled: boolean): void {
    this.deviceEnabled.set(enabled);
    void this.refreshDeviceDeck();
  }

  /** Toggle one device folder's inclusion, then re-sync the deck. */
  toggleDeviceFolder(name: string): void {
    this.deviceFolders.update((folders) =>
      folders.map((f) => (f.name === name ? { ...f, enabled: !f.enabled } : f)),
    );
    void this.refreshDeviceDeck();
  }

  private async loadAlbums(): Promise<void> {
    try {
      this.albums.set(await firstValueFrom(this.svc.getAlbums()));
    } catch {
      // Leave the album list empty; the Manage-albums screen will show "No albums match".
    }
  }

  toggleVacationAlbum(albumId: string): void {
    this.vacationAlbumIds.update((ids) =>
      ids.includes(albumId) ? ids.filter((id) => id !== albumId) : [...ids, albumId],
    );
  }

  private async loadPhotos(): Promise<void> {
    try {
      // Reuse today's already-chosen selection if we have one; otherwise sample a fresh feed and
      // store it, so the same units come back across reloads instead of re-randomizing.
      const today = todayKey();
      let photos = await this.reviewStore.getDailyFeed(today);
      if (!photos) {
        photos = await this.selectDailyUnits();
        if (photos.length > 0) {
          await this.reviewStore.setDailyFeed(today, photos);
        }
      }
      if (photos.length > 0) {
        // Overlay stored verdicts so in-progress swipes survive a reload, and append any enabled
        // device photos to the deck (device photos aren't persisted in the feed — they're rebuilt
        // from settings each load).
        const verdicts = await this.reviewStore.getVerdicts();
        const deck = [...photos, ...this.deviceDeck()];
        const withVerdicts = deck.map((p) => this.applyVerdict(p, verdicts.get(p.id)));
        this.reviewPhotos.set(withVerdicts);
        // Resume at the first un-reviewed photo, so a reload continues where you left off instead of
        // re-showing photos you already decided. (Done ones stay in the set for the progress count.)
        const firstUndone = withVerdicts.findIndex((p) => p.status === 'backlog');
        this.reviewIndex.set(firstUndone === -1 ? 0 : firstUndone);
        this.photosLoaded.set(true);
        this.canLoadMore.set(true);
        // Drop cached previews from earlier days, but keep today's selection AND tomorrow's
        // precomputed selection — otherwise we'd evict the previews precomputeTomorrow warmed ahead.
        const keep = new Set(withVerdicts.map((p) => p.id));
        const tomorrow = await this.reviewStore.getDailyFeed(tomorrowKey());
        tomorrow?.forEach((p) => keep.add(p.id));
        void this.previews.evictDurableExcept(keep);
        // Likewise drop stored selections for days other than today/tomorrow so they don't pile up.
        void this.reviewStore.pruneDailyFeedExcept(new Set([today, tomorrowKey()]));
      }
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
    await this.reviewStore.pruneDailyFeedExcept(new Set());
    await this.loadPhotos();
    void this.precomputeTomorrow();
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
    await this.albumManifests.clear(); // force every album to re-detect with the new threshold
    await this.catalogScan.scanAllAlbums();
    await this.resampleDailyFeed();
  }

  // Appends a fresh batch of unseen photos when the user is caught up but wants to keep going. Samples
  // generously and keeps only units no asset of which is already in the queue or already decided; if
  // nothing new remains, the population is exhausted and the "Review more" button hides.
  async loadMore(): Promise<void> {
    const verdicts = await this.reviewStore.getVerdicts();
    const inQueue = new Set(this.reviewPhotos().flatMap(unitAssetIds));
    const isFresh = (unit: ReviewItem): boolean =>
      unitAssetIds(unit).every(
        (id) => !inQueue.has(id) && (verdicts.get(id)?.status ?? 'backlog') === 'backlog',
      );

    const more = (await this.selectDailyUnits(this.dailyGoal() * 3))
      .filter(isFresh)
      .slice(0, this.dailyGoal());
    if (more.length === 0) {
      this.canLoadMore.set(false);
      return;
    }
    // Insert the new Lightroom units ahead of any device photos, and persist only the Lightroom feed
    // (device photos are rebuilt from settings, never stored).
    const base = this.reviewPhotos().filter((p) => !isDevicePhoto(p));
    const newBase = [...base, ...more];
    void this.reviewStore.setDailyFeed(todayKey(), newBase);
    this.reviewPhotos.set(newBase);
    await this.refreshDeviceDeck();
    const next = this.reviewPhotos().findIndex((p) => p.status === 'backlog');
    if (next !== -1) this.reviewIndex.set(next);
  }

  private async selectDailyUnits(limit: number = this.dailyGoal()): Promise<ReviewItem[]> {
    const units = await this.dailyUnits.buildUnits(this.vacationAlbumIds(), limit);
    if (units.length > 0) return units;
    const data = await firstValueFrom(this.svc.getFeed(this.vacationAlbumIds(), limit));
    return (data?.resources ?? [])
      .filter((a) => a.subtype === 'image')
      .map((a) => this.assetToPhoto(a));
  }

  // Warm-ahead: pick tomorrow's selection and fetch its previews into the durable store now, so
  // opening the app tomorrow needs no feed sample and no image downloads. Idempotent (skips if
  // tomorrow is already chosen) and best-effort (a failure just means tomorrow fetches live).
  private async precomputeTomorrow(): Promise<void> {
    try {
      const tomorrow = tomorrowKey();
      let units = await this.reviewStore.getDailyFeed(tomorrow);
      if (!units) {
        units = await this.selectDailyUnits();
        if (units.length === 0) return;
        await this.reviewStore.setDailyFeed(tomorrow, units);
      }
      // Warm previews into the durable store one at a time — background work, no need to flood the
      // network. Every frame id of each unit (a single photo, or all the frames of a burst/pano/stereo)
      // so group cards render their images instantly tomorrow, just like single photos.
      for (const unit of units) {
        for (const id of unitAssetIds(unit)) {
          await this.previews.warmDurable(id);
        }
      }
    } catch {
      // Precompute is best-effort; never surface an error to the user.
    }
  }

  // Background detection pass: tops the scanned-ahead buffer back up to SCAN_BUFFER_TARGET, populating
  // the metadata and group stores that selectDailyUnits reads. Best-effort; never blocks the UI. Only
  // scans the deficit, so a full buffer means no work — and a depleted one pulls in just what's missing.
  private async runBackgroundScan(): Promise<void> {
    if (!this.authenticated()) return; // no Lightroom session → nothing to scan
    try {
      const budget = await this.scanRefillBudget();
      if (budget > 0) await this.catalogScan.scanAllAlbums(budget);
    } catch {
      // Background work; a failure just means the next session falls back to the server sample.
    }
  }

  // How many more images to scan to refill the buffer: SCAN_BUFFER_TARGET minus the images already
  // scanned but not yet reviewed. (Group members reviewed only at the unit level — panos/stereos —
  // count as un-reviewed here, so the buffer can read a touch high; harmless, it just scans less.)
  private async scanRefillBudget(): Promise<number> {
    const [metaById, verdicts] = await Promise.all([
      this.meta.getAll(),
      this.reviewStore.getVerdicts(),
    ]);
    let unreviewed = 0;
    for (const id of metaById.keys()) {
      if (!verdicts.has(id)) unreviewed++;
    }
    return Math.max(0, SCAN_BUFFER_TARGET - unreviewed);
  }

  // Schedules a buffer top-up a short while after review activity, debounced so rapid swipes trigger
  // just one pass. Fired from the verdict-persist path, so any decision keeps the buffer replenished.
  private scheduleScanRefill(): void {
    if (!this.authenticated()) return;
    if (this.scanRefillTimer) clearTimeout(this.scanRefillTimer);
    this.scanRefillTimer = setTimeout(() => void this.runBackgroundScan(), SCAN_REFILL_DEBOUNCE_MS);
  }

  private applyVerdict(item: ReviewItem, verdict: StoredVerdict | undefined): ReviewItem {
    if (!verdict) return item;
    // starred/keepsake only exist on single photos; groups carry just a status.
    return item.kind === 'photo'
      ? { ...item, status: verdict.status, starred: verdict.starred, keepsake: verdict.keepsake }
      : { ...item, status: verdict.status };
  }

  private assetToPhoto(asset: PhotoAsset): Photo {
    const { name, ext } = splitFileName(asset.payload?.importSource?.fileName ?? asset.id);
    return {
      id: asset.id,
      name,
      ext,
      album: asset.album ?? null,
      taken: asset.payload?.captureDate ?? '',
      status: 'backlog',
      kind: 'photo',
      starred: false,
      keepsake: false,
    };
  }

  prevReviewPhoto(): void {
    if (this.reviewIndex() !== 0) {
      this.reviewIndex.set(this.reviewIndex() - 1);
    }
  }

  nextReviewPhoto(): void {
    if (this.reviewIndex() < this.reviewPhotos().length - 1) {
      this.reviewIndex.set(this.reviewIndex() + 1);
    }
  }

  setActiveTab(tab: 'review' | 'pipeline' | 'settings'): void {
    this.activeTab.set(tab);
    // Switching tabs closes the Settings sub-screens, so returning to Settings lands on the main page
    // rather than stranding anyone who missed a back arrow.
    this.manageAlbumsOpen.set(false);
    this.tagsManagerOpen.set(false);
  }

  // Opens the current single photo full screen (true orientation) with verdict buttons to review it.
  openPhotoFullscreen(): void {
    const current = this.currentReviewPhoto();
    if (current?.kind !== 'photo') return;
    this.fullscreenReviewMode.set(true);
    this.fullscreenStartIndex.set(0);
    this.fullscreenImages.set([{ label: current.name, url: this.currentReviewPhotoUrl() }]);
  }

  // Opens the given burst frames (the current duel pair) full screen, labelled A/B, starting on the
  // tapped frame.
  openBurstCompare(event: { ids: string[]; start: number }): void {
    const urls = this.currentUnitImageUrls();
    const images = event.ids.map((id, i) => ({
      label: String.fromCharCode(65 + i),
      url: urls.get(id),
    }));
    if (images.length === 0) return;
    this.fullscreenReviewMode.set(false);
    this.fullscreenStartIndex.set(event.start);
    this.fullscreenImages.set(images);
  }

  // A verdict from the full-screen viewer's buttons: decide the current photo, then show the next one
  // full screen (or close if the next isn't a single photo, or the session is done).
  fullscreenVerdict(verdict: 'kept' | 'rejected' | 'toEdit' | 'maybe'): void {
    this.decide(verdict);
    const current = this.currentReviewPhoto();
    if (!this.sessionDone() && current?.kind === 'photo') {
      this.fullscreenImages.set([{ label: current.name, url: this.currentReviewPhotoUrl() }]);
    } else {
      this.closeFullscreen();
    }
  }

  closeFullscreen(): void {
    this.fullscreenImages.set(null);
  }

  decide(verdict: 'kept' | 'rejected' | 'toEdit' | 'maybe'): void {
    const current = this.currentReviewPhoto();
    if (!current) return;

    this.reviewPhotos.update((list) =>
      list.map((item) => (item.id === current.id ? { ...item, status: verdict } : item)),
    );
    void this.persistVerdict(current.id);
    this.nextReviewPhoto();
  }

  toggleStar(): void {
    const current = this.currentReviewPhoto();
    if (!current) return;
    this.reviewPhotos.update((list) =>
      list.map((item) =>
        item.id === current.id && item.kind === 'photo'
          ? { ...item, starred: !item.starred }
          : item,
      ),
    );
    void this.persistVerdict(current.id);
  }

  toggleKeepsake(): void {
    const current = this.currentReviewPhoto();
    if (!current) return;
    this.reviewPhotos.update((list) =>
      list.map((item) =>
        item.id === current.id && item.kind === 'photo'
          ? { ...item, keepsake: !item.keepsake }
          : item,
      ),
    );
    void this.persistVerdict(current.id);
  }

  setReviewMode(mode: 'sort' | 'edit' | 'tag'): void {
    if (mode === 'tag') this.tagReviewIndex.set(0); // start the tag pass at the first keeper
    this.reviewMode.set(mode);
  }

  /** Settings toggle for the optional Tag step. Turning it off while in Tag mode falls back to Sort. */
  setTaggingEnabled(enabled: boolean): void {
    this.taggingEnabled.set(enabled);
    if (!enabled && this.reviewMode() === 'tag') this.reviewMode.set('sort');
  }

  /** Swipe in Tag mode: apply that direction's bound tag to the current photo, then advance. */
  swipeTag(dir: SwipeDir): void {
    const tagId = this.tagDirections()[dir];
    const photo = this.currentTagPhoto();
    if (!tagId || !photo) return;
    const current = this.tagAssignments()[photo.id] ?? [];
    if (!current.includes(tagId)) {
      const next = [...current, tagId];
      this.tagAssignments.update((map) => ({ ...map, [photo.id]: next }));
      void this.assetTags.set(photo.id, next);
    }
    this.nextTagPhoto();
  }

  /** Bind (or clear) a swipe direction to a tag. A tag lives on at most one direction. */
  setTagDirection(change: { dir: SwipeDir; tagId: string | null }): void {
    this.tagDirections.update((dirs) => {
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
  toggleTag(tagId: string): void {
    const photo = this.currentTagPhoto();
    if (!photo) return;
    const current = this.tagAssignments()[photo.id] ?? [];
    const next = current.includes(tagId) ? current.filter((t) => t !== tagId) : [...current, tagId];
    this.tagAssignments.update((map) => ({ ...map, [photo.id]: next }));
    void this.assetTags.set(photo.id, next);
  }

  nextTagPhoto(): void {
    if (this.tagReviewIndex() < this.taggablePhotos().length - 1) {
      this.tagReviewIndex.update((i) => i + 1);
    }
  }

  prevTagPhoto(): void {
    if (this.tagReviewIndex() > 0) this.tagReviewIndex.update((i) => i - 1);
  }

  // Resolves a burst's duel: the winning frame is kept, every other frame rejected. Marks the burst
  // unit done (so it leaves the queue and counts toward the goal) and persists per-frame verdicts.
  resolveBurst(winnerId: string): void {
    const current = this.currentReviewPhoto();
    if (current?.kind !== 'burst') return;
    this.reviewPhotos.update((list) =>
      list.map((item) => (item.id === current.id ? { ...item, status: 'kept' as const } : item)),
    );
    void this.persistVerdict(current.id); // burst unit itself: done, survives reload
    for (const frame of current.photos) {
      const status = frame.id === winnerId ? ('kept' as const) : ('rejected' as const);
      void this.reviewStore.setVerdict(frame.id, { status, starred: false, keepsake: false });
    }
    this.nextReviewPhoto();
  }

  rejectBurst(): void {
    const current = this.currentReviewPhoto();
    if (!current) return;
    this.reviewPhotos.update((list) =>
      list.map((item) =>
        item.id === current.id ? { ...item, status: 'rejected' as const } : item,
      ),
    );
    void this.persistVerdict(current.id);
    this.nextReviewPhoto();
  }

  // "Not a burst" — the user says these frames aren't a real group. Replace the burst with its frames
  // as individual photos to review now, and record an override so the group stays dissolved across
  // reloads and re-scans (selection drops it). Stays put on the first frame.
  dissolveBurst(): void {
    const current = this.currentReviewPhoto();
    if (current?.kind !== 'burst') return;
    const singles = current.photos.map((frame) => burstFrameToPhoto(frame, current));
    this.reviewPhotos.update((list) =>
      list.flatMap((item) => (item.id === current.id ? singles : [item])),
    );
    void this.reviewStore.setDailyFeed(todayKey(), this.reviewPhotos());
    void this.recordDissolve(current);
  }

  // Persists the "not a group" override so the group stays dissolved across reloads and re-scans.
  // Deliberately records no threshold-calibration signal: a dissolve can mean "I want both" just as
  // much as "detection was wrong", so it isn't reliable evidence the threshold is too loose.
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

  // "This is actually a pano" — relabel the current burst, swap its card in place, and persist the
  // correction so it survives reloads + re-scans. Orientation defaults to horizontal (the user can't
  // pick one from a single button). Stays put on the same unit.
  markBurstAsPano(): void {
    const current = this.currentReviewPhoto();
    if (current?.kind !== 'burst') return;
    const pano = burstToPano(current);
    this.replaceCurrentUnit(current, pano);
    void this.recordReclassify(
      current.photos.map((p) => p.id),
      'pano',
      'horizontal',
    );
  }

  // "This is actually a burst" — relabel the current pano and swap its card in place.
  markPanoAsBurst(): void {
    const current = this.currentReviewPhoto();
    if (current?.kind !== 'pano') return;
    const burst = panoToBurst(current);
    this.replaceCurrentUnit(current, burst);
    void this.recordReclassify(
      current.frames.map((f) => f.id),
      'burst',
    );
  }

  // Swaps one review unit for a re-typed version of itself (burst↔pano), keeping its place + status,
  // and re-persists the day's feed so the relabel survives a reload.
  private replaceCurrentUnit(from: ReviewItem, to: ReviewItem): void {
    this.reviewPhotos.update((list) => list.map((item) => (item.id === from.id ? to : item)));
    void this.reviewStore.setDailyFeed(todayKey(), this.reviewPhotos());
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

  promoteToPrint(id: string): void {
    this.reviewPhotos.update((list) =>
      list.map((item) => (item.id === id ? { ...item, status: 'toPrint' as const } : item)),
    );
    void this.persistVerdict(id);
    this.editedToday.update((n) => n + 1);
  }

  // Saves the (already-updated) review item's verdict to IndexedDB so it survives a reload.
  // Best-effort: a storage failure must not break the review flow.
  private async persistVerdict(id: string): Promise<void> {
    const item = this.reviewPhotos().find((p) => p.id === id);
    if (!item) return;
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
    // A review decision shrinks the scanned-ahead buffer — top it back up (debounced).
    this.scheduleScanRefill();
    // A decision may have just carried the day's count over the sorting goal — celebrate it.
    this.maybeCelebrateGoal();
  }

  // Fires the in-app "goal hit" celebration the moment the day's reviewed count reaches the sorting
  // goal — once per day (persisted), so reopening the app after finishing doesn't re-congratulate you.
  private maybeCelebrateGoal(): void {
    if (!this.photosLoaded()) return;
    const goal = this.dailyGoal();
    if (goal <= 0 || this.doneToday() < goal) return;
    const today = todayKey();
    if (localStorage.getItem('celebratedGoal') === today) return;
    localStorage.setItem('celebratedGoal', today);
    this.celebration.set({
      icon: '🎉',
      title: `That's ${goal} — daily goal done`,
      text: 'Lovely work. Everything from here is a bonus.',
    });
  }

  private groupByAlbum(photos: Photo[]): { album: string; photos: Photo[] }[] {
    const map = new Map<string, Photo[]>();
    for (const p of photos) {
      const key = p.album ?? 'No album';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return Array.from(map.entries()).map(([album, photos]) => ({ album, photos }));
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
    this.svc.clearTokens();
    this.authenticated.set(false);
    this.connecting.set(false);
    this.photosLoaded.set(false);
    this.previews.revokeAll();
    this.reviewPhotos.set([]); // drop Lightroom photos; device photos (if any) are re-added below
    await this.refreshDeviceDeck();
  }

  ngOnDestroy(): void {
    this.previews.revokeAll();
    if (this.goalResampleTimer) clearTimeout(this.goalResampleTimer);
    if (this.burstRescanTimer) clearTimeout(this.burstRescanTimer);
    if (this.scanRefillTimer) clearTimeout(this.scanRefillTimer);
  }
}
