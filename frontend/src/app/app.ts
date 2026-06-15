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
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { firstValueFrom, timeout } from 'rxjs';
import { Album, LightroomService, PhotoAsset } from './lightroom.service';
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
  // 2048px rendition of the photo currently under review, fetched as a blob object URL.
  currentReviewPhotoUrl = signal<SafeUrl | null>(null);
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
  private readonly objectUrls: string[] = [];
  private lastLoadedReviewId: string | null = null;

  constructor() {
    effect(() => {
      localStorage.setItem('dailyGoal', String(this.dailyGoal()));
      localStorage.setItem('editGoal', String(this.editGoal()));
      localStorage.setItem('reminderTime', this.reminderTime());
      localStorage.setItem('silentTime', this.silentTime());
      localStorage.setItem('silentEvening', String(this.silentEvening()));
      localStorage.setItem('vacationAlbumIds', JSON.stringify(this.vacationAlbumIds()));
    });

    // Whenever the photo under review changes, fetch its 2048 rendition. Guarded by photosLoaded so
    // the mock fallback (whose ids aren't real assets) never triggers a request, and deduped by id
    // so a status change on the same photo doesn't refetch.
    effect(() => {
      const photo = this.currentReviewPhoto();
      if (!this.photosLoaded() || !photo || photo.kind !== 'photo') return;
      if (photo.id === this.lastLoadedReviewId) return;
      this.lastLoadedReviewId = photo.id;
      this.loadReviewImage(photo.id);
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

    const token = params.get('token');
    if (token) {
      this.svc.setAuthToken(token);
      window.history.replaceState({}, '', window.location.pathname);
    }

    try {
      const status = await firstValueFrom(this.svc.checkStatus().pipe(timeout(5000)));
      this.authenticated.set(status.authenticated);
    } catch {
      this.authenticated.set(false);
    } finally {
      this.loading.set(false);
    }

    if (this.authenticated()) {
      await this.loadPhotos();
      await this.loadAlbums();
    }
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
      const data = await firstValueFrom(this.svc.getFeed(this.vacationAlbumIds(), 20));
      const resources = data?.resources ?? [];
      const photos = resources
        .filter((a) => a.subtype === 'image')
        .map((a) => this.assetToPhoto(a));
      if (photos.length > 0) {
        this.reviewPhotos.set(photos);
        this.reviewIndex.set(0);
        this.photosLoaded.set(true);
      }
    } catch (e: unknown) {
      this.error.set(
        'Could not load photos: ' + (e instanceof Error ? e.message : 'unknown error'),
      );
    }
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

  private loadReviewImage(assetId: string): void {
    this.currentReviewPhotoUrl.set(null);
    this.svc.getPhotoBlob(assetId, '2048').subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        this.objectUrls.push(url);
        this.currentReviewPhotoUrl.set(this.sanitizer.bypassSecurityTrustUrl(url));
      },
      error: () => {
        // Leave the gradient placeholder if the rendition can't be fetched.
        this.currentReviewPhotoUrl.set(null);
      },
    });
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
    this.nextReviewPhoto();
  }

  promoteToPrint(id: string): void {
    this.reviewPhotos.update((list) =>
      list.map((item) => (item.id === id ? { ...item, status: 'toPrint' as const } : item)),
    );
    this.editedToday.update((n) => n + 1);
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
    this.svc.clearAuthToken();
    this.authenticated.set(false);
    this.photosLoaded.set(false);
    this.currentReviewPhotoUrl.set(null);
    this.lastLoadedReviewId = null;
  }

  ngOnDestroy(): void {
    this.objectUrls.forEach((u) => URL.revokeObjectURL(u));
  }
}
