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
import { SignatureStore } from '../storage/signature-store';
import { DetectionSettingsService } from '../detection/detection-settings.service';
import { BurstOptions, DetectAsset } from '../detection/burst';
import { SIGNATURE_SIZE } from '../detection/phash';
import { PanoAsset, PanoOptions, overlapMatch } from '../detection/pano';
import { FrameSignature, PanoOrientation } from '../storage/photokeeper-db';
import {
  LabCluster,
  LabPanoCluster,
  analyzeClusters,
  analyzePanoClusters,
} from '../detection/lab-analysis';

/** A matched region as CSS percentages, for overlaying on a lab thumbnail. */
interface StripRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A strip plus the colour of the seam it belongs to (shared with the facing frame's strip). */
type SeamStrip = StripRect & { color: string };

/** One seam between two adjacent pano frames: the matched overlap regions, colour, and both axis scores. */
interface PanoSeam {
  color: string;
  hScore: number; // best horizontal slide score (lower = better continuation)
  vScore: number; // best vertical slide score
  overlap: number; // overlap fraction on the chosen axis [0, 1]
  aStrip: StripRect; // matched region on the earlier frame
  bStrip: StripRect; // matched region on the later frame (same overlap → same colour)
}

/** Distinct colours cycled across a pano's seams, so each overlap stands out. */
const SEAM_COLORS = ['#e0a83c', '#4ea0e0', '#7bd86a', '#e06c9c', '#b07be0'];
const seamColor = (seam: number): string => SEAM_COLORS[seam % SEAM_COLORS.length];

const EMPTY_STRIP: StripRect = { left: 0, top: 0, width: 0, height: 0 };

/** The two matched overlap bands for a seam, ordered [earlier frame, later frame]. */
function seamBands(
  orientation: PanoOrientation,
  forward: boolean,
  overlap: number,
): [StripRect, StripRect] {
  const o = overlap * 100;
  const left: StripRect = { left: 0, top: 0, width: o, height: 100 };
  const right: StripRect = { left: 100 - o, top: 0, width: o, height: 100 };
  const top: StripRect = { left: 0, top: 0, width: 100, height: o };
  const bottom: StripRect = { left: 0, top: 100 - o, width: 100, height: o };
  if (orientation === 'horizontal') return forward ? [right, left] : [left, right];
  return forward ? [bottom, top] : [top, bottom];
}

/** Resolves one seam from two frames' signatures: both axis scores, plus the matched overlap bands. */
function buildSeam(
  orientation: PanoOrientation,
  sa: FrameSignature | undefined,
  sb: FrameSignature | undefined,
  color: string,
  opts: PanoOptions,
): PanoSeam {
  if (!sa || !sb) {
    return {
      color,
      hScore: NaN,
      vScore: NaN,
      overlap: 0,
      aStrip: EMPTY_STRIP,
      bStrip: EMPTY_STRIP,
    };
  }
  const hm = overlapMatch(sa, sb, 'horizontal', opts);
  const vm = overlapMatch(sa, sb, 'vertical', opts);
  const chosen = orientation === 'horizontal' ? hm : vm;
  const [aStrip, bStrip] = seamBands(orientation, chosen.forward, chosen.overlap);
  return {
    color,
    hScore: Math.round(hm.score),
    vScore: Math.round(vm.score),
    overlap: chosen.overlap,
    aStrip,
    bStrip,
  };
}

/** Small rendition used for both the hash source and the lab thumbnails (one fetch serves both). */
const LAB_RENDITION = '640';
/** Nearest-neighbour zoom when exporting a signature, so the 64×64 grid is actually viewable. */
const SIGNATURE_ZOOM = 4;

/** Renders a grayscale signature grid to a zoomed PNG blob (crisp pixels, no smoothing). */
async function signatureToPng(signature: FrameSignature): Promise<Blob> {
  const n = SIGNATURE_SIZE;
  const small = new OffscreenCanvas(n, n);
  const sctx = small.getContext('2d');
  if (!sctx) throw new Error('no 2d context');
  const img = sctx.createImageData(n, n);
  for (let p = 0; p < n * n; p++) {
    const v = signature[p];
    img.data[p * 4] = v;
    img.data[p * 4 + 1] = v;
    img.data[p * 4 + 2] = v;
    img.data[p * 4 + 3] = 255;
  }
  sctx.putImageData(img, 0, 0);

  const big = new OffscreenCanvas(n * SIGNATURE_ZOOM, n * SIGNATURE_ZOOM);
  const bctx = big.getContext('2d');
  if (!bctx) throw new Error('no 2d context');
  bctx.imageSmoothingEnabled = false;
  bctx.drawImage(small, 0, 0, big.width, big.height);
  return big.convertToBlob({ type: 'image/png' });
}

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
  imports: [],
})
export class DetectionLabComponent implements OnInit {
  private readonly svc = inject(LightroomService);
  private readonly hasher = inject(ImageHasher);
  private readonly previews = inject(PreviewStore);
  private readonly hashStore = inject(HashStore);
  private readonly signatureStore = inject(SignatureStore);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly settings = inject(DetectionSettingsService);

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

  clusters = computed<LabCluster[]>(() =>
    analyzeClusters(this.frames().map(toDetectAsset), this.hashes(), this.opts()),
  );

  panoClusters = computed<LabPanoCluster[]>(() =>
    analyzePanoClusters(
      this.frames().map(toPanoAsset),
      this.signatures(),
      this.hashes(),
      this.panoOpts(),
    ),
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
      this.hashes.set(hashes);
      this.signatures.set(signatures);
      this.thumbs.set(thumbs);
    } catch {
      this.error.set('Analysis failed — check auth / network.');
    } finally {
      this.analyzing.set(false);
    }
  }

  /** Saves each analyzed frame's 640px rendition (a numbered prefix keeps capture order). */
  async downloadFrames(): Promise<void> {
    const frames = this.frames();
    for (let i = 0; i < frames.length; i++) {
      const blob = this.frameBlobs.get(frames[i].id);
      if (blob) await this.save(blob, `${prefix(i)}_${frames[i].name}.jpg`);
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
