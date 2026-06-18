import {
  Component,
  OnInit,
  computed,
  inject,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import { Album, LightroomService, PhotoAsset } from '../lightroom.service';
import { ImageHasher } from '../detection/image-hasher';
import { PreviewStore } from '../storage/preview-store';
import { HashStore } from '../storage/hash-store';
import { DetectionSettingsService } from '../detection/detection-settings.service';
import { BurstOptions, DetectAsset } from '../detection/burst';
import { LabCluster, analyzeClusters } from '../detection/lab-analysis';

/** Small rendition used for both the hash source and the lab thumbnails (one fetch serves both). */
const LAB_RENDITION = '640';

interface LabFrame {
  id: string;
  name: string;
  taken: string;
}

/**
 * Developer-only detection lab (reached via `?lab`). Loads one album, hashes every frame on demand,
 * then re-runs burst clustering live as the threshold sliders move — showing each detected burst with
 * the frames that bracket it, so it's clear what the thresholds include vs exclude.
 */
@Component({
  selector: 'app-detection-lab',
  templateUrl: './detection-lab.html',
  styleUrl: './detection-lab.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
})
export class DetectionLabComponent implements OnInit {
  private readonly svc = inject(LightroomService);
  private readonly hasher = inject(ImageHasher);
  private readonly previews = inject(PreviewStore);
  private readonly hashStore = inject(HashStore);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly settings = inject(DetectionSettingsService);

  albums = signal<Album[]>([]);
  selectedAlbumId = signal('');
  analyzing = signal(false);
  progressPct = signal(0);
  error = signal<string | null>(null);

  frames = signal<LabFrame[]>([]);
  private readonly hashes = signal<Map<string, string>>(new Map());
  private readonly thumbs = signal<Map<string, SafeUrl>>(new Map());

  // Sliders, seeded from the saved detection settings.
  windowSec = signal(this.settings.burstOptions().windowMs / 1000);
  maxHamming = signal(this.settings.burstOptions().maxHamming);
  minSize = signal(this.settings.burstOptions().minSize);

  private readonly opts = computed<BurstOptions>(() => ({
    windowMs: this.windowSec() * 1000,
    maxHamming: this.maxHamming(),
    minSize: this.minSize(),
  }));

  clusters = computed<LabCluster[]>(() =>
    analyzeClusters(this.frames().map(toDetectAsset), this.hashes(), this.opts()),
  );

  ngOnInit(): void {
    void this.loadAlbums();
  }

  frameName(id: string): string {
    return this.frames().find((f) => f.id === id)?.name ?? id;
  }

  thumb(id: string): SafeUrl | undefined {
    return this.thumbs().get(id);
  }

  secs(ms: number): string {
    return (ms / 1000).toFixed(1);
  }

  onAlbumChange(event: Event): void {
    this.selectedAlbumId.set((event.target as HTMLSelectElement).value);
  }

  onWindow(event: Event): void {
    this.windowSec.set(Number((event.target as HTMLInputElement).value));
  }

  onMaxHamming(event: Event): void {
    this.maxHamming.set(Number((event.target as HTMLInputElement).value));
  }

  onMinSize(event: Event): void {
    this.minSize.set(Number((event.target as HTMLInputElement).value));
  }

  async analyze(): Promise<void> {
    const albumId = this.selectedAlbumId();
    if (!albumId || this.analyzing()) return;
    this.analyzing.set(true);
    this.progressPct.set(0);
    this.error.set(null);
    try {
      const assets = (await firstValueFrom(this.svc.getAllAlbumAssets(albumId))).filter(
        (a) => a.subtype === 'image',
      );
      const sorted = [...assets].sort((a, b) =>
        (a.payload?.captureDate ?? '').localeCompare(b.payload?.captureDate ?? ''),
      );
      const hashes = await this.hashStore.getAll();
      const thumbs = new Map<string, SafeUrl>();
      let done = 0;
      for (const asset of sorted) {
        const blob =
          (await this.previews.get(asset.id, LAB_RENDITION)) ??
          (await firstValueFrom(this.svc.getPhotoBlob(asset.id, LAB_RENDITION)));
        await this.previews.put(asset.id, LAB_RENDITION, blob);
        if (!hashes.has(asset.id)) hashes.set(asset.id, await this.hasher.hash(blob));
        // Safe: blob: URL minted from our own fetched rendition, not user input.
        // eslint-disable-next-line sonarjs/no-angular-bypass-sanitization
        thumbs.set(asset.id, this.sanitizer.bypassSecurityTrustUrl(URL.createObjectURL(blob)));
        this.progressPct.set(Math.round((++done / sorted.length) * 100));
      }
      this.frames.set(sorted.map(toLabFrame));
      this.hashes.set(hashes);
      this.thumbs.set(thumbs);
    } catch {
      this.error.set('Analysis failed — check auth / network.');
    } finally {
      this.analyzing.set(false);
    }
  }

  private async loadAlbums(): Promise<void> {
    try {
      this.albums.set(await firstValueFrom(this.svc.getAlbums()));
    } catch {
      this.error.set('Could not load albums.');
    }
  }
}

function toDetectAsset(frame: LabFrame): DetectAsset {
  return { id: frame.id, taken: frame.taken };
}

function toLabFrame(asset: PhotoAsset): LabFrame {
  const fileName = asset.payload?.importSource?.fileName ?? asset.id;
  return {
    id: asset.id,
    name: fileName.replace(/\.[^.]+$/, ''),
    taken: asset.payload?.captureDate ?? '',
  };
}
