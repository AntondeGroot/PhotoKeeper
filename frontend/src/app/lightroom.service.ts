import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

const TOKEN_KEY = 'lr-auth-token';

@Injectable({ providedIn: 'root' })
export class LightroomService {
  private readonly http = inject(HttpClient);
  private authToken: string | null = null;

  setAuthToken(token: string): void {
    this.authToken = token;
    localStorage.setItem(TOKEN_KEY, token);
  }

  getAuthToken(): string | null {
    if (!this.authToken) {
      this.authToken = localStorage.getItem(TOKEN_KEY);
    }
    return this.authToken;
  }

  clearAuthToken(): void {
    this.authToken = null;
    localStorage.removeItem(TOKEN_KEY);
  }

  checkStatus(): Observable<{ authenticated: boolean }> {
    return this.http.get<{ authenticated: boolean }>('/api/auth/status', {
      headers: this.headers()
    });
  }

  getPhotos(limit = 20): Observable<{ resources: PhotoAsset[] }> {
    return this.http.get<{ resources: PhotoAsset[] }>('/api/photos', {
      headers: this.headers(),
      params: { limit }
    });
  }

  getPhotoBlob(assetId: string, size = '640'): Observable<Blob> {
    return this.http.get(`/api/photos/${assetId}/rendition`, {
      headers: this.headers(),
      params: { size },
      responseType: 'blob'
    });
  }

  logout(): Observable<void> {
    return this.http.delete<void>('/api/auth/logout', {
      headers: this.headers()
    });
  }

  private headers(): Record<string, string> {
    const token = this.getAuthToken();
    return token ? { 'X-Auth-Token': token } : {};
  }
}

export interface PhotoAsset {
  id: string;
  subtype: string;
  payload?: {
    captureDate?: string;
    userCreated?: string;
    importSource?: { fileName?: string };
  };
}