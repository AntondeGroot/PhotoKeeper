import {
  Component,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  untracked,
  ChangeDetectionStrategy,
} from '@angular/core';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import { Album, LightroomService, PhotoAsset } from './lightroom.service';
import { ReviewStore } from './storage/review-store';
import { PreviewStore } from './storage/preview-store';
import { StoredVerdict } from './storage/photokeeper-db';
import { Photo, ReviewItem, MOCK_PHOTOS, MOCK_BURST, MOCK_PANO, MOCK_STEREO } from './photo';
import { ReviewSortComponent } from './review-sort/review-sort';
import { SessionDoneComponent } from './session-done/session-done';
import { ReviewEditComponent } from './review-edit/review-edit';
import { PipelineComponent } from './pipeline/pipeline';
import { SettingsComponent } from './settings/settings';
import { BurstCardComponent } from './burst-card/burst-card';
import { PanoCardComponent } from './pano-card/pano-card';
import { StereoCardComponent } from './stereo-card/stereo-card';
import { AlbumManagerComponent } from './album-manager/album-manager';

// How many photos ahead of the current one to preload, so swiping never waits for an image.
const PREFETCH_AHEAD = 5;

// Preview size requested + cached (Lightroom 2048px preview).
const PREVIEW_SIZE = '2048';

// A cached preview keeps both the raw object URL (so it can be revoked on eviction) and the
// sanitized SafeUrl (stable reference, so re-reads don't re-trigger the <img> binding).
interface CachedPreview {
  objectUrl: string;
  safeUrl: SafeUrl;
}

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

function tomorrowKey(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return dateKey(d);
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
  ],
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './app.scss',
})
export class AppComponent implements OnInit, OnDestroy {
  private readonly svc = inject(LightroomService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly reviewStore = inject(ReviewStore);
  private readonly previewStore = inject(PreviewStore);

  readonly loginHref = this.svc.loginHref();
  loading = signal(true);
  authenticated = signal(false);
  activeTab = signal<'review' | 'pipeline' | 'settings'>('review');
  reviewMode = signal<'sort' | 'edit'>('sort');
  reviewIndex = signal(0);
  // Album list (from the backend) + the ids the user has tagged as "vacation", and whether the
  // Manage-albums sub-screen is open. Vacation tags persist to localStorage like the other settings.
  albums = signal<Album[]>([]);
  vacationAlbumIds = signal<string[]>([]);
  manageAlbumsOpen = signal(false);
  error = signal<string | null>(null);
  dailyGoal = signal(15);
  editGoal = signal(3);
  editedToday = signal(0);
  reminderTime = signal('09:00');
  silentTime = signal('21:00');
  silentEvening = signal(true);

  // Lightroom photos replace the mock list once they load; until then the mock data acts as a
  // fallback so the UI still works offline / before auth.
  reviewPhotos = signal<ReviewItem[]>([...MOCK_PHOTOS, MOCK_BURST, MOCK_PANO, MOCK_STEREO]);
  photosLoaded = signal(false);
  currentReviewPhoto = computed(() => this.reviewPhotos()[this.reviewIndex()]);
  // Cache of fetched 2048px previews (assetId → preview), filled ahead of the cursor so
  // navigating never waits, and evicted once a photo falls behind the window. currentReviewPhotoUrl
  // simply reads the current photo's entry.
  private readonly previewCache = signal<Map<string, CachedPreview>>(new Map());
  currentReviewPhotoUrl = computed(() => {
    const current = this.currentReviewPhoto();
    return current?.kind === 'photo'
      ? (this.previewCache().get(current.id)?.safeUrl ?? null)
      : null;
  });
  doneToday = computed(() => this.reviewPhotos().filter((p) => p.status !== 'backlog').length);
  sessionDone = computed(() => this.doneToday() === this.reviewPhotos().length);
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
  // Asset ids whose preview is mid-flight, so we never fire a duplicate request.
  private readonly inFlight = new Set<string>();

  constructor() {
    effect(() => {
      localStorage.setItem('dailyGoal', String(this.dailyGoal()));
      localStorage.setItem('editGoal', String(this.editGoal()));
      localStorage.setItem('reminderTime', this.reminderTime());
      localStorage.setItem('silentTime', this.silentTime());
      localStorage.setItem('silentEvening', String(this.silentEvening()));
      localStorage.setItem('vacationAlbumIds', JSON.stringify(this.vacationAlbumIds()));
    });

    // Keep the current photo's preview plus the next PREFETCH_AHEAD ones loaded, so swiping never
    // waits, and evict anything outside that window (we only ever move forward). Guarded by
    // photosLoaded so the mock fallback (whose ids aren't real assets) is skipped.
    effect(() => {
      if (!this.photosLoaded()) return;
      const photos = this.reviewPhotos();
      const start = this.reviewIndex();
      const windowIds = new Set<string>();
      for (let i = 0; i <= PREFETCH_AHEAD; i++) {
        const item = photos[start + i];
        if (item?.kind === 'photo') {
          windowIds.add(item.id);
          void this.ensurePreview(item.id);
        }
      }
      this.evictOutsideWindow(windowIds);
    });
  }

  ngOnInit(): void {
    const savedDailyGoal = localStorage.getItem('dailyGoal');
    if (savedDailyGoal) this.dailyGoal.set(Number(savedDailyGoal));
    const savedEditGoal = localStorage.getItem('editGoal');
    if (savedEditGoal) this.editGoal.set(Number(savedEditGoal));
    const savedReminderTime = localStorage.getItem('reminderTime');
    if (savedReminderTime) this.reminderTime.set(savedReminderTime);
    const savedSilentTime = localStorage.getItem('silentTime');
    if (savedSilentTime) this.silentTime.set(savedSilentTime);
    const savedSilentEvening = localStorage.getItem('silentEvening');
    if (savedSilentEvening) this.silentEvening.set(savedSilentEvening === 'true');
    const savedVacation = localStorage.getItem('vacationAlbumIds');
    if (savedVacation) {
      const parsed: unknown = JSON.parse(savedVacation);
      if (Array.isArray(parsed)) {
        this.vacationAlbumIds.set(parsed.filter((id): id is string => typeof id === 'string'));
      }
    }
    void this.init();
  }

  private async init(): Promise<void> {
    const params = new URLSearchParams(window.location.search);
    const authError = params.get('auth_error');
    if (authError) {
      const detail = params.get('detail');
      this.error.set(`Login failed: ${authError}${detail ? ' — ' + detail : ''}`);
      window.history.replaceState({}, '', window.location.pathname);
      this.loading.set(false);
      return;
    }

    // After login the backend redirects with the tokens in the URL fragment; capture and store them.
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const accessToken = hash.get('access_token');
    const refreshToken = hash.get('refresh_token');
    if (accessToken && refreshToken) {
      this.svc.setTokens(accessToken, refreshToken);
      window.history.replaceState({}, '', window.location.pathname);
    }

    if (this.svc.getAccessToken()) {
      try {
        // Fetching the catalog id both caches it and validates the token (refreshing if expired).
        await firstValueFrom(this.svc.loadCatalogId());
        this.authenticated.set(true);
        await this.loadPhotos();
        await this.loadAlbums();
        void this.precomputeTomorrow(); // warm tomorrow ahead; never blocks first paint
      } catch {
        // Token couldn't be validated/refreshed — fall back to the login screen.
        this.svc.clearTokens();
        this.authenticated.set(false);
      }
    }
    this.loading.set(false);
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
      // store it, so the same photos come back across reloads instead of re-randomizing.
      const today = todayKey();
      let photos = await this.reviewStore.getDailyFeed(today);
      if (!photos) {
        const data = await firstValueFrom(this.svc.getFeed(this.vacationAlbumIds(), 20));
        photos = (data?.resources ?? [])
          .filter((a) => a.subtype === 'image')
          .map((a) => this.assetToPhoto(a));
        if (photos.length > 0) {
          await this.reviewStore.setDailyFeed(today, photos);
        }
      }
      if (photos.length > 0) {
        // Overlay stored verdicts so in-progress swipes survive a reload.
        const verdicts = await this.reviewStore.getVerdicts();
        const withVerdicts = photos.map((p) => this.applyVerdict(p, verdicts.get(p.id)));
        this.reviewPhotos.set(withVerdicts);
        // Resume at the first un-reviewed photo, so a reload continues where you left off instead of
        // re-showing photos you already decided. (Done ones stay in the set for the progress count.)
        const firstUndone = withVerdicts.findIndex((p) => p.status === 'backlog');
        this.reviewIndex.set(firstUndone === -1 ? 0 : firstUndone);
        this.photosLoaded.set(true);
        // Drop cached previews from earlier days, but keep today's selection AND tomorrow's
        // precomputed selection — otherwise we'd evict the previews precomputeTomorrow warmed ahead.
        const keep = new Set(withVerdicts.map((p) => p.id));
        const tomorrow = await this.reviewStore.getDailyFeed(tomorrowKey());
        tomorrow?.forEach((p) => keep.add(p.id));
        void this.previewStore.evictExcept(keep);
      }
    } catch (e: unknown) {
      this.error.set(
        'Could not load photos: ' + (e instanceof Error ? e.message : 'unknown error'),
      );
    }
  }

  // Warm-ahead: sample tomorrow's selection and fetch its previews into the durable store now, so
  // opening the app tomorrow needs no feed sample and no image downloads. Idempotent (skips if
  // tomorrow is already chosen) and best-effort (a failure just means tomorrow fetches live).
  private async precomputeTomorrow(): Promise<void> {
    try {
      const tomorrow = tomorrowKey();
      let photos = await this.reviewStore.getDailyFeed(tomorrow);
      if (!photos) {
        const data = await firstValueFrom(this.svc.getFeed(this.vacationAlbumIds(), 20));
        photos = (data?.resources ?? [])
          .filter((a) => a.subtype === 'image')
          .map((a) => this.assetToPhoto(a));
        if (photos.length === 0) return;
        await this.reviewStore.setDailyFeed(tomorrow, photos);
      }
      // Fetch previews one at a time — this is background work, no need to flood the network.
      for (const p of photos) {
        if (await this.previewStore.get(p.id, PREVIEW_SIZE)) continue;
        try {
          const blob = await firstValueFrom(this.svc.getPhotoBlob(p.id, PREVIEW_SIZE));
          await this.previewStore.put(p.id, PREVIEW_SIZE, blob);
        } catch {
          // Leave it; tomorrow's session will fetch this preview on demand.
        }
      }
    } catch {
      // Precompute is best-effort; never surface an error to the user.
    }
  }

  private applyVerdict(photo: Photo, verdict: StoredVerdict | undefined): Photo {
    return verdict
      ? { ...photo, status: verdict.status, starred: verdict.starred, keepsake: verdict.keepsake }
      : photo;
  }

  private assetToPhoto(asset: PhotoAsset): Photo {
    const fileName = asset.payload?.importSource?.fileName ?? asset.id;
    return {
      id: asset.id,
      name: fileName.replace(/\.[^.]+$/, ''),
      album: asset.album ?? null,
      taken: asset.payload?.captureDate ?? '',
      status: 'backlog',
      kind: 'photo',
      starred: false,
      keepsake: false,
    };
  }

  // Makes a photo's preview available in the in-memory window cache. Idempotent (skips ids already
  // cached or in flight). Reads the durable IndexedDB store first — so on a reload the image is
  // already there with no network — and only fetches + stores it when it's genuinely missing. The
  // cache read is untracked so the prefetch effect doesn't re-run on every load.
  private async ensurePreview(assetId: string): Promise<void> {
    const alreadyHave = untracked(
      () => this.previewCache().has(assetId) || this.inFlight.has(assetId),
    );
    if (alreadyHave) return;

    this.inFlight.add(assetId);
    try {
      let blob = await this.previewStore.get(assetId, PREVIEW_SIZE);
      if (!blob) {
        blob = await firstValueFrom(this.svc.getPhotoBlob(assetId, PREVIEW_SIZE));
        await this.previewStore.put(assetId, PREVIEW_SIZE, blob);
      }
      const objectUrl = URL.createObjectURL(blob);
      const safeUrl = this.sanitizer.bypassSecurityTrustUrl(objectUrl);
      this.previewCache.update((cache) => new Map(cache).set(assetId, { objectUrl, safeUrl }));
    } catch {
      // Leave the gradient placeholder if the preview can't be fetched.
    } finally {
      this.inFlight.delete(assetId);
    }
  }

  // Drops cached previews outside the current window, revoking their object URLs so memory doesn't
  // grow without bound. (Read untracked so this never re-triggers the prefetch effect.)
  private evictOutsideWindow(keep: Set<string>): void {
    const cache = untracked(() => this.previewCache());
    const next = new Map(cache);
    let changed = false;
    for (const [id, preview] of cache) {
      if (!keep.has(id)) {
        URL.revokeObjectURL(preview.objectUrl);
        next.delete(id);
        changed = true;
      }
    }
    if (changed) {
      this.previewCache.set(next);
    }
  }

  private revokeAllPreviews(): void {
    for (const preview of this.previewCache().values()) {
      URL.revokeObjectURL(preview.objectUrl);
    }
    this.previewCache.set(new Map());
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

  setReviewMode(mode: 'sort' | 'edit'): void {
    this.reviewMode.set(mode);
  }

  pickFromBurst(): void {
    const current = this.currentReviewPhoto();
    if (!current) return;
    this.reviewPhotos.update((list) =>
      list.map((item) => (item.id === current.id ? { ...item, status: 'kept' as const } : item)),
    );
    void this.persistVerdict(current.id);
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

  async logout(): Promise<void> {
    try {
      await firstValueFrom(this.svc.logout());
    } catch {
      /* ignore */
    }
    this.svc.clearTokens();
    this.authenticated.set(false);
    this.photosLoaded.set(false);
    this.revokeAllPreviews();
    this.inFlight.clear();
  }

  ngOnDestroy(): void {
    this.revokeAllPreviews();
  }
}
