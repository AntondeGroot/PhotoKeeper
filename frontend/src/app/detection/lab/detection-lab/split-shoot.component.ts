// Lab panel for a shoot split across two albums: pick the left-eye album and the right-eye album and
// see, frame by frame, whether each eye found its partner and why not when it didn't.
//
// The lab's main view analyses one album, which is the wrong shape for this question entirely: the
// two frames that pair are in *different* albums, so nothing about either album on its own says
// whether the pairing works. This fetches both, hashes what is not cached, and runs the real
// `pairEyes`.
//
// A refused frame is shown *beside the frame it was refused against*, because a distance on its own
// settles nothing: 21 between two photographs of the same moment means the tolerance is wrong, and
// 21 between two different scenes means it is right.

import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import { Album, LightroomService } from '../../../lightroom.service';
import { PhotoAsset } from '../../../lightroom-types';
import { splitFileName } from '../../../photo';
import { ImageHasher } from '../../detectors/image-hasher';
import { HashStore } from '../../../storage/detection/hash-store';
import { SignatureStore } from '../../../storage/detection/signature-store';
import { PreviewStore } from '../../../storage/review/preview-store';
import { DetectionSettingsService } from '../../scan/detection-settings.service';
import { FrameSignature } from '../../detectors/detection-types';
import { SplitShootFrame, SplitShootReport, buildSplitShootReport } from './split-shoot';

/** Same rendition the lab and the scan hash from, so the numbers here are the numbers there. */
const RENDITION = '640';

@Component({
  selector: 'app-split-shoot',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './split-shoot.component.html',
  styleUrl: './split-shoot.component.scss',
})
export class SplitShootComponent {
  private readonly svc = inject(LightroomService);
  private readonly hasher = inject(ImageHasher);
  private readonly hashStore = inject(HashStore);
  private readonly signatureStore = inject(SignatureStore);
  private readonly previews = inject(PreviewStore);
  private readonly settings = inject(DetectionSettingsService);
  private readonly sanitizer = inject(DomSanitizer);

  readonly albums = input<Album[]>([]);
  readonly leftId = signal('');
  readonly rightId = signal('');
  readonly running = signal(false);
  readonly progress = signal('');
  readonly error = signal('');
  readonly report = signal<SplitShootReport | null>(null);
  /** The album names as they were when the report was built, so the labels cannot drift off it. */
  readonly leftAlbumName = signal('left');
  readonly rightAlbumName = signal('right');
  readonly thumbs = signal<Map<string, SafeUrl>>(new Map());

  /** Object URLs minted for the thumbnails, so a re-run can hand them back. */
  private objectUrls: string[] = [];

  async pair(): Promise<void> {
    if (this.running()) return;
    // One album cannot be a split shoot: matched against itself every frame's nearest neighbour is
    // another frame of the same album, which reads exactly like the matcher pairing left with left.
    if (this.leftId() === this.rightId()) {
      this.error.set('Pick two different albums — a split shoot is one shoot across two of them.');
      return;
    }
    this.running.set(true);
    this.error.set('');
    this.report.set(null);
    this.revokeThumbs();
    this.leftAlbumName.set(this.albumName(this.leftId()));
    this.rightAlbumName.set(this.albumName(this.rightId()));
    try {
      const hashes = await this.hashStore.getAll();
      const signatures = await this.signatureStore.getAll();
      const left = await this.loadSide(this.leftId(), 'left', hashes, signatures);
      const right = await this.loadSide(this.rightId(), 'right', hashes, signatures);
      const report = buildSplitShootReport({
        left,
        right,
        signatures,
        tolerance: this.settings.eyePairOptions().maxDistance,
      });
      this.report.set(report);
      await this.loadThumbs(report);
    } catch {
      this.error.set('Pairing failed — check auth / network.');
    } finally {
      this.running.set(false);
      this.progress.set('');
    }
  }

  thumb(id: string): SafeUrl | undefined {
    return this.thumbs().get(id);
  }

  private albumName(albumId: string): string {
    return this.albums().find((album) => album.id === albumId)?.name ?? albumId;
  }

  /**
   * One album's frames, with the hash and signature the matcher needs. What the scan already cached
   * is reused and anything missing is computed here — so the panel reports the truth about a
   * half-scanned album rather than inventing it, while still being able to answer "would these pair
   * if they *had* been scanned?".
   */
  private async loadSide(
    albumId: string,
    side: string,
    hashes: Map<string, string>,
    signatures: Map<string, FrameSignature>,
  ): Promise<SplitShootFrame[]> {
    const assets = (await firstValueFrom(this.svc.getAllAlbumAssets(albumId)))
      .filter((asset) => asset.subtype === 'image')
      .sort((a, b) => takenOf(a).localeCompare(takenOf(b)));

    let done = 0;
    for (const asset of assets) {
      this.progress.set(`${side} ${++done}/${assets.length}`);
      if (hashes.has(asset.id) && signatures.has(asset.id)) continue;
      const blob = await this.rendition(asset.id);
      if (!hashes.has(asset.id)) hashes.set(asset.id, await this.hasher.hash(blob));
      if (!signatures.has(asset.id)) signatures.set(asset.id, await this.hasher.signature(blob));
    }

    return assets.map((asset) => ({
      id: asset.id,
      taken: takenOf(asset),
      name: splitFileName(asset.payload?.importSource?.fileName ?? asset.id).name,
    }));
  }

  /**
   * Thumbnails for the frames a refusal is about — the frame, the candidate it was refused against,
   * and the frame that took that candidate instead — and nothing else. A whole album of thumbnails
   * would be a great deal of fetching for pictures nobody is going to question.
   */
  private async loadThumbs(report: SplitShootReport): Promise<void> {
    const wanted = report.rows
      .filter((row) => row.outcome === 'rejected' && row.other)
      .flatMap((row) => [
        row.left.id,
        row.other!.id,
        ...(row.claimedBy ? [row.claimedBy.frame.id] : []),
      ]);

    const thumbs = new Map<string, SafeUrl>();
    let done = 0;
    for (const id of new Set(wanted)) {
      this.progress.set(`previews ${++done}`);
      const url = URL.createObjectURL(await this.rendition(id));
      this.objectUrls.push(url);
      // Safe: a blob: URL minted from our own fetched rendition, not from user input.
      // eslint-disable-next-line sonarjs/no-angular-bypass-sanitization
      thumbs.set(id, this.sanitizer.bypassSecurityTrustUrl(url));
    }
    this.thumbs.set(thumbs);
  }

  /** The frame's small rendition, from the store when it is already there. */
  private async rendition(assetId: string): Promise<Blob> {
    const cached = await this.previews.get(assetId, RENDITION);
    if (cached) return cached;
    const blob = await firstValueFrom(this.svc.getPhotoBlob(assetId, RENDITION));
    await this.previews.put(assetId, RENDITION, blob);
    return blob;
  }

  private revokeThumbs(): void {
    this.objectUrls.forEach((url) => URL.revokeObjectURL(url));
    this.objectUrls = [];
    this.thumbs.set(new Map());
  }
}

function takenOf(asset: PhotoAsset): string {
  return asset.payload?.captureDate ?? '';
}
