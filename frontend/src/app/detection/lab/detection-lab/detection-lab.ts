import {
  Component,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import { Album, LightroomService } from '../../../lightroom.service';
import { PhotoAsset } from '../../../lightroom-types';
import { ImageHasher } from '../../detectors/image-hasher';
import { PreviewStore } from '../../../storage/review/preview-store';
import { HashStore } from '../../../storage/detection/hash-store';
import { SignatureStore } from '../../../storage/detection/signature-store';
import { DetectionSettingsService } from '../../scan/detection-settings.service';
import { BurstOptions, DetectAsset } from '../../detectors/burst';
import { PanoAsset, PanoOptions } from '../../detectors/pano';
import { StereoOptions } from '../../detectors/stereo';
import { FrameSignature } from '../../detectors/detection-types';
import {
  HashSplit,
  LabCluster,
  LabPanoCluster,
  analyzeClusters,
  analyzePanoClusters,
  analyzeStereo,
  hashSplit,
  signatureMad,
} from '../lab-analysis';
import { Stereo, unitAssetIds } from '../../../photo';
import { PreferencesService } from '../../../preferences.service';
import { PreviewCacheService } from '../../../review/preview-cache.service';
import { StereoCardComponent } from '../../../review/stereo-card/stereo-card';
import { CameraProbeComponent } from './camera-probe.component'; // throwaway (stereo-pairing)
import { AlbumSpikeComponent } from './album-spike.component'; // throwaway (lightroom-write-back)
import { stripJpegMetadata } from './lab-jpeg';
import { signatureToPng } from './lab-signature';
import { PanoSeam, SeamStrip, buildSeam, seamColor } from './lab-seams';

/** Small rendition used for both the hash source and the lab thumbnails (one fetch serves both). */
const LAB_RENDITION = '640';

interface LabFrame {
  id: string;
  name: string;
  taken: string;
  aspect: number; // width / height of the rendition, for the pano aspect gate
}

/**
 * Developer-only detection lab (reached via `?lab`). Loads one album, hashes every frame on demand,
 * then re-runs burst + pano clustering live as the threshold sliders move — showing each detected group
 * with the frames that bracket it, so it's clear what the thresholds include vs exclude. Panos draw the
 * matched overlap regions found by the slide-matcher.
 */
@Component({
  selector: 'app-detection-lab',
  templateUrl: './detection-lab.html',
  styleUrl: './detection-lab.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    StereoCardComponent,
    CameraProbeComponent /* throwaway (stereo-pairing) */,
    AlbumSpikeComponent /* throwaway (lightroom-write-back) */,
  ],
})
export class DetectionLabComponent implements OnInit {
  private readonly svc = inject(LightroomService);
  private readonly hasher = inject(ImageHasher);
  private readonly previews = inject(PreviewStore);
  private readonly hashStore = inject(HashStore);
  private readonly signatureStore = inject(SignatureStore);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly settings = inject(DetectionSettingsService);
  private readonly prefs = inject(PreferencesService);
  private readonly previewCache = inject(PreviewCacheService);

  constructor() {
    // The lab hosts its own stereo cards, so it warms their frame previews (like review's prefetch).
    effect(() =>
      this.stereoUnits().forEach((u) =>
        unitAssetIds(u).forEach((id) => void this.previewCache.ensure(id)),
      ),
    );
  }

  albums = signal<Album[]>([]);
  selectedAlbumId = signal('');
  analyzing = signal(false);
  progressPct = signal(0);
  error = signal<string | null>(null);

  frames = signal<LabFrame[]>([]);
  private readonly hashes = signal<Map<string, string>>(new Map());
  private readonly signatures = signal<Map<string, FrameSignature>>(new Map());
  private readonly thumbs = signal<Map<string, SafeUrl>>(new Map());
  // The raw 640px rendition blobs from the last Analyze, so they can be exported for inspection.
  private readonly frameBlobs = new Map<string, Blob>();
  // Per-group export extensions (keyed by the group's first member id): whether the before/after
  // bracket frame is pulled into the group's downloadable set, for curating test fixtures.
  private readonly includeBefore = signal<Set<string>>(new Set());
  private readonly includeAfter = signal<Set<string>>(new Set());

  // Burst sliders, seeded from the saved detection settings.
  windowSec = signal(this.settings.burstOptions().windowMs / 1000);
  maxHamming = signal(this.settings.burstOptions().maxHamming);
  minSize = signal(this.settings.burstOptions().minSize);

  // Pano sliders, seeded from the pano defaults (overlap as a percentage for the UI).
  panoWindowSec = signal(this.settings.panoOptions().windowMs / 1000);
  panoMaxSeamScore = signal(this.settings.panoOptions().maxSeamScore);
  panoMinWholeHamming = signal(this.settings.panoOptions().minWholeHamming);
  panoMinOverlapPct = signal(Math.round(this.settings.panoOptions().minOverlap * 100));
  panoMaxOverlapPct = signal(Math.round(this.settings.panoOptions().maxOverlap * 100));
  panoMinSize = signal(this.settings.panoOptions().minSize);

  private readonly opts = computed<BurstOptions>(() => ({
    windowMs: this.windowSec() * 1000,
    maxHamming: this.maxHamming(),
    minSize: this.minSize(),
  }));

  private readonly panoOpts = computed<PanoOptions>(() => ({
    windowMs: this.panoWindowSec() * 1000,
    minWholeHamming: this.panoMinWholeHamming(),
    maxSeamScore: this.panoMaxSeamScore(),
    minOverlap: this.panoMinOverlapPct() / 100,
    maxOverlap: this.panoMaxOverlapPct() / 100,
    minSize: this.panoMinSize(),
  }));

  // Stereo sliders, seeded from the stereo defaults. The raw analysed assets (with GPS + camera EXIF)
  // are kept so detected sets hydrate into the exact review unit — including twin-rig serial pairing.
  stereoMaxHamming = signal(this.settings.stereoOptions().maxHamming);
  stereoMaxMeters = signal(this.settings.stereoOptions().maxMeters);
  stereoMinSize = signal(this.settings.stereoOptions().minSize);
  private readonly assets = signal<PhotoAsset[]>([]);

  private readonly stereoOpts = computed<StereoOptions>(() => ({
    maxHamming: this.stereoMaxHamming(),
    maxMeters: this.stereoMaxMeters(),
    minSize: this.stereoMinSize(),
  }));

  private readonly selectedAlbumName = computed(
    () => this.albums().find((a) => a.id === this.selectedAlbumId())?.name ?? null,
  );

  clusters = computed<LabCluster[]>(() =>
    analyzeClusters(this.frames().map(toDetectAsset), this.hashes(), this.opts()),
  );

  /** Detected stereo sets, hydrated into real review units so the lab reflects the actual L/R pairing. */
  stereoUnits = computed<Stereo[]>(() => {
    const albumName = this.selectedAlbumName();
    const leftSerial = albumName ? this.prefs.stereoLeftSerial()[albumName] : undefined;
    return analyzeStereo(this.assets(), this.hashes(), this.stereoOpts(), albumName, leftSerial);
  });

  panoClusters = computed<LabPanoCluster[]>(() => {
    // Bursts win, mirroring the scan: a pano that shares any frame with a detected burst is dropped, so
    // near-duplicate frames aren't also shown as a (spurious) pano.
    const burstMembers = new Set(this.clusters().flatMap((c) => c.memberIds));
    return analyzePanoClusters(
      this.frames().map(toPanoAsset),
      this.signatures(),
      this.hashes(),
      this.panoOpts(),
    ).filter((p) => !p.memberIds.some((id) => burstMembers.has(id)));
  });

  ngOnInit(): void {
    void this.loadAlbums();
  }

  frameName(id: string): string {
    return this.frames().find((f) => f.id === id)?.name ?? id;
  }

  /** Full/luma/colour Hamming between two frames, for the member-to-member and bracket readouts. */
  ham(a: string, b: string): HashSplit | null {
    const hashes = this.hashes();
    return hashSplit(hashes.get(a), hashes.get(b));
  }

  /** Mean-normalised, shift-tolerant signature MAD between two frames — the dHash alternative to compare. */
  mad(a: string, b: string): number | null {
    const signatures = this.signatures();
    return signatureMad(signatures.get(a), signatures.get(b));
  }

  thumb(id: string): SafeUrl | undefined {
    return this.thumbs().get(id);
  }

  secs(ms: number): string {
    return (ms / 1000).toFixed(1);
  }

  pct(fraction: number): number {
    return Math.round(fraction * 100);
  }

  /** The seams of a pano (one per adjacent pair), resolved from the loaded signatures. */
  panoSeams(cluster: LabPanoCluster): PanoSeam[] {
    const ids = cluster.memberIds;
    const signatures = this.signatures();
    const opts = this.panoOpts();
    const seams: PanoSeam[] = [];
    for (let i = 0; i < ids.length - 1; i++) {
      const seam = buildSeam(
        cluster.orientation,
        signatures.get(ids[i]),
        signatures.get(ids[i + 1]),
        seamColor(i),
        opts,
      );
      seams.push(seam);
    }
    return seams;
  }

  /** Per-frame highlight strips: frame i carries seam i-1's later strip and seam i's earlier strip. */
  panoMemberStrips(seams: readonly PanoSeam[], count: number): SeamStrip[][] {
    const strips: SeamStrip[][] = Array.from({ length: count }, () => []);
    seams.forEach((s, i) => {
      strips[i].push({ ...s.aStrip, color: s.color });
      strips[i + 1].push({ ...s.bStrip, color: s.color });
    });
    return strips;
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

  onPanoWindow(event: Event): void {
    this.panoWindowSec.set(Number((event.target as HTMLInputElement).value));
  }

  onPanoMaxSeamScore(event: Event): void {
    this.panoMaxSeamScore.set(Number((event.target as HTMLInputElement).value));
  }

  onPanoMinWholeHamming(event: Event): void {
    this.panoMinWholeHamming.set(Number((event.target as HTMLInputElement).value));
  }

  onPanoMinOverlap(event: Event): void {
    this.panoMinOverlapPct.set(Number((event.target as HTMLInputElement).value));
  }

  onPanoMaxOverlap(event: Event): void {
    this.panoMaxOverlapPct.set(Number((event.target as HTMLInputElement).value));
  }

  onPanoMinSize(event: Event): void {
    this.panoMinSize.set(Number((event.target as HTMLInputElement).value));
  }

  onStereoMaxHamming(event: Event): void {
    this.stereoMaxHamming.set(Number((event.target as HTMLInputElement).value));
  }

  onStereoMaxMeters(event: Event): void {
    this.stereoMaxMeters.set(Number((event.target as HTMLInputElement).value));
  }

  onStereoMinSize(event: Event): void {
    this.stereoMinSize.set(Number((event.target as HTMLInputElement).value));
  }

  /** Persist the album's left-eye serial; the stereoUnits computed re-hydrates, flipping every set. */
  swapStereoEyes(e: { albumName: string | null; leftSerial: string }): void {
    if (!e.albumName) return;
    const albumName = e.albumName;
    this.prefs.stereoLeftSerial.update((m) => ({ ...m, [albumName]: e.leftSerial }));
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
      const signatures = await this.signatureStore.getAll();
      const thumbs = new Map<string, SafeUrl>();
      const aspects = new Map<string, number>();
      this.frameBlobs.clear();
      let done = 0;
      for (const asset of sorted) {
        const blob =
          (await this.previews.get(asset.id, LAB_RENDITION)) ??
          (await firstValueFrom(this.svc.getPhotoBlob(asset.id, LAB_RENDITION)));
        await this.previews.put(asset.id, LAB_RENDITION, blob);
        this.frameBlobs.set(asset.id, blob);
        if (!hashes.has(asset.id)) hashes.set(asset.id, await this.hasher.hash(blob));
        if (!signatures.has(asset.id)) signatures.set(asset.id, await this.hasher.signature(blob));
        aspects.set(asset.id, await aspectOf(blob));
        // Safe: blob: URL minted from our own fetched rendition, not user input.
        // eslint-disable-next-line sonarjs/no-angular-bypass-sanitization
        thumbs.set(asset.id, this.sanitizer.bypassSecurityTrustUrl(URL.createObjectURL(blob)));
        this.progressPct.set(Math.round((++done / sorted.length) * 100));
      }
      this.frames.set(sorted.map((a) => toLabFrame(a, aspects.get(a.id) ?? 1)));
      this.assets.set(sorted); // raw assets (GPS + camera EXIF) for stereo hydration
      this.hashes.set(hashes);
      this.signatures.set(signatures);
      this.thumbs.set(thumbs);
    } catch {
      this.error.set('Analysis failed — check auth / network.');
    } finally {
      this.analyzing.set(false);
    }
  }

  /** Saves each analyzed frame's 640px rendition (metadata-stripped; a numbered prefix keeps order). */
  async downloadFrames(): Promise<void> {
    const frames = this.frames();
    for (let i = 0; i < frames.length; i++) {
      const blob = this.frameBlobs.get(frames[i].id);
      if (blob)
        await this.save(await stripJpegMetadata(blob), `${prefix(i)}_${frames[i].name}.jpg`);
    }
  }

  /** Saves each frame's 64×64 grayscale signature as a zoomed PNG — the exact pixels the matcher sees. */
  async downloadSignatures(): Promise<void> {
    const frames = this.frames();
    const sigs = this.signatures();
    for (let i = 0; i < frames.length; i++) {
      const sig = sigs.get(frames[i].id);
      if (sig) await this.save(await signatureToPng(sig), `${prefix(i)}_${frames[i].name}_sig.png`);
    }
  }

  isBeforeIncluded(key: string): boolean {
    return this.includeBefore().has(key);
  }

  isAfterIncluded(key: string): boolean {
    return this.includeAfter().has(key);
  }

  /** Pull the before-bracket frame into (or out of) the group's downloadable set. */
  toggleBefore(key: string): void {
    this.includeBefore.update((set) => toggled(set, key));
  }

  toggleAfter(key: string): void {
    this.includeAfter.update((set) => toggled(set, key));
  }

  /** A group's export set: its members, plus whichever bracket neighbours the user opted to include. */
  groupExportIds(memberIds: readonly string[], beforeId?: string, afterId?: string): string[] {
    const key = memberIds[0];
    const ids = [...memberIds];
    if (beforeId && this.includeBefore().has(key)) ids.unshift(beforeId);
    if (afterId && this.includeAfter().has(key)) ids.push(afterId);
    return ids;
  }

  /** Saves the 640px renditions of one group's export set (metadata-stripped), named `NN_<frame>`. */
  async downloadGroupFrames(ids: readonly string[]): Promise<void> {
    for (let i = 0; i < ids.length; i++) {
      const blob = this.frameBlobs.get(ids[i]);
      if (blob)
        await this.save(
          await stripJpegMetadata(blob),
          `${prefix(i)}_${this.frameName(ids[i])}.jpg`,
        );
    }
  }

  /** Saves the signature PNGs of one group's export set, named `NN_<frame>_sig`. */
  async downloadGroupSignatures(ids: readonly string[]): Promise<void> {
    const sigs = this.signatures();
    for (let i = 0; i < ids.length; i++) {
      const sig = sigs.get(ids[i]);
      if (sig)
        await this.save(
          await signatureToPng(sig),
          `${prefix(i)}_${this.frameName(ids[i])}_sig.png`,
        );
    }
  }

  private async save(blob: Blob, filename: string): Promise<void> {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
    await new Promise((resolve) => setTimeout(resolve, 150)); // let the browser queue each save
  }

  private async loadAlbums(): Promise<void> {
    try {
      this.albums.set(await firstValueFrom(this.svc.getAlbums()));
    } catch {
      this.error.set('Could not load albums.');
    }
  }
}

/** Zero-padded capture-order prefix for an exported filename, so frames sort in sequence. */
function prefix(index: number): string {
  return String(index + 1).padStart(2, '0');
}

/** A copy of `set` with `key` toggled in/out. */
function toggled(set: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(set);
  if (!next.delete(key)) next.add(key);
  return next;
}

function toDetectAsset(frame: LabFrame): DetectAsset {
  return { id: frame.id, taken: frame.taken };
}

function toPanoAsset(frame: LabFrame): PanoAsset {
  return { id: frame.id, taken: frame.taken, aspect: frame.aspect };
}

function toLabFrame(asset: PhotoAsset, aspect: number): LabFrame {
  const fileName = asset.payload?.importSource?.fileName ?? asset.id;
  return {
    id: asset.id,
    name: fileName.replace(/\.[^.]+$/, ''),
    taken: asset.payload?.captureDate ?? '',
    aspect,
  };
}

/** Decoded width/height ratio of a rendition (EXIF applied), for the pano aspect gate. */
async function aspectOf(blob: Blob): Promise<number> {
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  try {
    return bitmap.height > 0 ? bitmap.width / bitmap.height : 1;
  } finally {
    bitmap.close();
  }
}
