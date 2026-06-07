import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import { LightroomService, PhotoAsset } from './lightroom.service';

@Component({
  selector: 'app-root',
  imports: [],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnInit {
  private readonly svc = inject(LightroomService);
  private readonly sanitizer = inject(DomSanitizer);

  loading = signal(true);
  authenticated = signal(false);
  photos = signal<PhotoAsset[]>([]);
  currentIndex = signal(0);
  currentPhotoUrl = signal<SafeUrl | null>(null);
  loadingPhoto = signal(false);
  error = signal<string | null>(null);

  currentPhoto = computed(() => this.photos()[this.currentIndex()]);
  totalPhotos = computed(() => this.photos().length);
  hasPrev = computed(() => this.currentIndex() > 0);
  hasNext = computed(() => this.currentIndex() < this.totalPhotos() - 1);

  private objectUrls: string[] = [];

  async ngOnInit() {
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

  private async loadPhotos() {
    try {
      const data = await firstValueFrom(this.svc.getPhotos(20));
      const resources = data?.resources ?? [];
      this.photos.set(resources.filter(a => a.subtype === 'image'));
      if (this.photos().length > 0) {
        this.loadPhoto(0);
      }
    } catch (e: any) {
      this.error.set('Could not load photos: ' + (e?.message ?? 'unknown error'));
    }
  }

  private loadPhoto(index: number) {
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
      }
    });
  }

  prevPhoto() {
    if (!this.hasPrev()) return;
    const idx = this.currentIndex() - 1;
    this.currentIndex.set(idx);
    this.loadPhoto(idx);
  }

  nextPhoto() {
    if (!this.hasNext()) return;
    const idx = this.currentIndex() + 1;
    this.currentIndex.set(idx);
    this.loadPhoto(idx);
  }

  captureDate(): string | null {
    const raw = this.currentPhoto()?.payload?.captureDate;
    if (!raw) return null;
    try {
      return new Date(raw).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    } catch {
      return raw;
    }
  }

  fileName(): string | null {
    return this.currentPhoto()?.payload?.importSource?.fileName ?? null;
  }

  async logout() {
    try { await firstValueFrom(this.svc.logout()); } catch { /* ignore */ }
    this.svc.clearAuthToken();
    this.authenticated.set(false);
    this.photos.set([]);
    this.currentPhotoUrl.set(null);
  }

  ngOnDestroy() {
    this.objectUrls.forEach(u => URL.revokeObjectURL(u));
  }
}