import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import { LightroomService, PhotoAsset } from './lightroom.service';
import { Photo, MOCK_PHOTOS } from './photo';
import { ReviewSortComponent } from './review-sort/review-sort';
import { SessionDoneComponent } from './session-done/session-done';
import { ReviewEditComponent } from './review-edit/review-edit';
import { PipelineComponent } from './pipeline/pipeline';

@Component({
  selector: 'app-root',
  imports: [ReviewSortComponent, SessionDoneComponent, ReviewEditComponent, PipelineComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class AppComponent implements OnInit, OnDestroy {
  private readonly svc = inject(LightroomService);
  private readonly sanitizer = inject(DomSanitizer);

  loading = signal(true);
  authenticated = signal(false);
  photos = signal<PhotoAsset[]>([]);
  currentIndex = signal(0);
  currentPhotoUrl = signal<SafeUrl | null>(null);
  loadingPhoto = signal(false);
  activeTab = signal<'review' | 'pipeline' | 'settings'>('review');
  reviewMode = signal<'sort' | 'edit'>('sort');
  reviewIndex = signal(0);
  error = signal<string | null>(null);
  dailyGoal = signal(15);
  editGoal = signal(3);
  editedToday = signal(0);

  currentPhoto = computed(() => this.photos()[this.currentIndex()]);
  totalPhotos = computed(() => this.photos().length);
  hasPrev = computed(() => this.currentIndex() > 0);
  hasNext = computed(() => this.currentIndex() < this.totalPhotos() - 1);

  reviewPhotos = signal<Photo[]>(MOCK_PHOTOS);
  currentReviewPhoto = computed(() => this.reviewPhotos()[this.reviewIndex()]);
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
  toEditQueue = computed(() => this.reviewPhotos().filter((p) => p.status === 'toEdit'));
  editDone = computed(
    () => this.editedToday() >= this.editGoal() || this.toEditQueue().length === 0,
  );
  toPrintQueue = computed(() => this.reviewPhotos().filter((p) => p.status === 'toPrint'));
  toEditByAlbum = computed(() => this.groupByAlbum(this.toEditQueue()));
  toPrintByAlbum = computed(() => this.groupByAlbum(this.toPrintQueue()));
  private readonly objectUrls: string[] = [];

  ngOnInit(): void {
    void this.init();
  }

  private async init(): Promise<void> {
    const params = new URLSearchParams(window.location.search);
    const authError = params.get('auth_error');
    if (authError) {
      const detail = params.get('detail');
      this.error.set(`Login failed: ${authError}${detail ? ' — ' + detail : ''}`);
      window.history.replaceState({}, '', '/');
      this.loading.set(false);
      return;
    }

    const token = params.get('token');
    if (token) {
      this.svc.setAuthToken(token);
      window.history.replaceState({}, '', '/');
    }

    try {
      const status = await firstValueFrom(this.svc.checkStatus());
      this.authenticated.set(status.authenticated);
    } catch {
      this.authenticated.set(false);
    } finally {
      this.loading.set(false);
    }

    if (this.authenticated()) {
      await this.loadPhotos();
    }
  }

  private async loadPhotos(): Promise<void> {
    try {
      const data = await firstValueFrom(this.svc.getPhotos(20));
      const resources = data?.resources ?? [];
      this.photos.set(resources.filter((a) => a.subtype === 'image'));
      if (this.photos().length > 0) {
        this.loadPhoto(0);
      }
    } catch (e: unknown) {
      this.error.set(
        'Could not load photos: ' + (e instanceof Error ? e.message : 'unknown error'),
      );
    }
  }

  private loadPhoto(index: number): void {
    const photo = this.photos()[index];
    if (!photo) return;

    this.loadingPhoto.set(true);
    this.currentPhotoUrl.set(null);

    this.svc.getPhotoBlob(photo.id).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        this.objectUrls.push(url);
        this.currentPhotoUrl.set(this.sanitizer.bypassSecurityTrustUrl(url));
        this.loadingPhoto.set(false);
      },
      error: () => {
        this.error.set('Could not load photo rendition');
        this.loadingPhoto.set(false);
      },
    });
  }

  prevPhoto(): void {
    if (!this.hasPrev()) return;
    const idx = this.currentIndex() - 1;
    this.currentIndex.set(idx);
    this.loadPhoto(idx);
  }

  nextPhoto(): void {
    if (!this.hasNext()) return;
    const idx = this.currentIndex() + 1;
    this.currentIndex.set(idx);
    this.loadPhoto(idx);
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
      list.map((item) => (item.id === current.id ? { ...item, starred: !item.starred } : item)),
    );
  }

  toggleKeepsake(): void {
    const current = this.currentReviewPhoto();
    if (!current) return;
    this.reviewPhotos.update((list) =>
      list.map((item) => (item.id === current.id ? { ...item, keepsake: !item.keepsake } : item)),
    );
  }

  setReviewMode(mode: 'sort' | 'edit'): void {
    this.reviewMode.set(mode);
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

  captureDate(): string | null {
    const raw = this.currentPhoto()?.payload?.captureDate;
    if (!raw) return null;
    try {
      return new Date(raw).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return raw;
    }
  }

  fileName(): string | null {
    return this.currentPhoto()?.payload?.importSource?.fileName ?? null;
  }

  async logout(): Promise<void> {
    try {
      await firstValueFrom(this.svc.logout());
    } catch {
      /* ignore */
    }
    this.svc.clearAuthToken();
    this.authenticated.set(false);
    this.photos.set([]);
    this.currentPhotoUrl.set(null);
  }

  ngOnDestroy(): void {
    this.objectUrls.forEach((u) => URL.revokeObjectURL(u));
  }
}
