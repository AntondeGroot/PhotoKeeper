import { Injectable, inject, signal } from '@angular/core';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import { LightroomService } from '../lightroom.service';
import { KeeperAlbumsService } from '../keeper-albums.service';
import { ReviewStore } from '../storage/review/review-store';
import { AssetMetaStore } from '../storage/review/asset-meta-store';
import { ReviewFeedService } from './review-feed.service';
import { ReviewStatus } from '../photo';

/** One photo as the reconsider grid shows it. */
export interface DecidedPhoto {
  assetId: string;
  /** As Lightroom shows it, so a photograph can be recognised by more than its picture. */
  name: string;
  /** What the app currently thinks of it, so the grid can say what it is undoing. */
  status: ReviewStatus;
}

/** The hash-sized rendition: big enough to recognise a photograph, small enough to fetch a hundred. */
const THUMB_SIZE = '640';

/**
 * Changing a verdict long after it was made.
 *
 * <p>Undo reaches the last twenty decisions of this session, and deliberately no further: past that
 * the photos have been written into the Keeper albums, and Lightroom cannot take them out again. But
 * "I have a photo in KeeperDelete and I actually like it" is a different question from undo. Nothing
 * has to be un-written — the verdict simply changes, the sweep files it where it now belongs, and
 * the album it used to be in shows up on this same screen as something to take it out of.
 *
 * <p>So the photos come from the album rather than from the app's own records: it is the album the
 * user is looking at when they realise, and everything in it is there because the app put it there.
 */
@Injectable({ providedIn: 'root' })
export class ReconsiderService {
  private readonly svc = inject(LightroomService);
  private readonly albums = inject(KeeperAlbumsService);
  private readonly reviews = inject(ReviewStore);
  private readonly meta = inject(AssetMetaStore);
  private readonly feed = inject(ReviewFeedService);
  private readonly sanitizer = inject(DomSanitizer);

  /**
   * A picture per photo, fetched as the grid opens and released when it closes.
   *
   * Its own copy of the small dance {@link EditDetectionService} does, rather than a shared service:
   * shared, one screen closing would revoke the other's pictures, and these two live in different
   * tabs with no idea of each other.
   */
  readonly thumbnails = signal<ReadonlyMap<string, SafeUrl>>(new Map());
  private objectUrls: string[] = [];

  /** Everything the app has decided that is sitting in this album, newest filing first. */
  async photosIn(album: string): Promise<DecidedPhoto[]> {
    await this.albums.ensure();
    const albumId = this.albums.idFor(album);
    if (!albumId) throw new Error(`no ${album} album`);

    const [held, verdicts, meta] = await Promise.all([
      firstValueFrom(this.svc.getAllAlbumAssets(albumId)),
      this.reviews.getVerdicts(),
      this.meta.getAll(),
    ]);
    return (
      held
        // A tombstone is a photograph that has been deleted; there is no verdict left to reconsider.
        .filter((asset) => asset.subtype !== 'deleted_image')
        .map((asset) => ({
          assetId: asset.id,
          name: asset.payload?.importSource?.fileName ?? meta.get(asset.id)?.name ?? asset.id,
          status: verdicts.get(asset.id)?.status ?? 'backlog',
        }))
    );
  }

  /**
   * Gives a photo a new verdict, wherever it is.
   *
   * Written to the deck as well as to the store: the deck is what the tabs are built from, so a
   * photo re-judged here would otherwise keep its old standing on screen until the app was next
   * reloaded. Starred and keep-but-do-not-print are carried over — they say something about the
   * photograph that this decision is not about.
   */
  async reverdict(assetId: string, status: ReviewStatus): Promise<void> {
    const was = (await this.reviews.getVerdicts()).get(assetId);
    await this.reviews.setVerdict(assetId, {
      status,
      starred: was?.starred ?? false,
      saveOnly: was?.saveOnly ?? false,
    });
    this.feed.photos.update((list) =>
      list.map((item) => (item.id === assetId ? { ...item, status } : item)),
    );
  }

  /** Fetches the pictures for these photos, one at a time so a big album does not open at once. */
  async loadThumbnails(assetIds: readonly string[]): Promise<void> {
    for (const assetId of assetIds) {
      if (this.thumbnails().has(assetId)) continue;
      try {
        const blob = await firstValueFrom(this.svc.getPhotoBlob(assetId, THUMB_SIZE));
        const objectUrl = URL.createObjectURL(blob);
        this.objectUrls.push(objectUrl);
        // Safe: minted from a blob this service fetched, not from anything a user typed.
        // eslint-disable-next-line sonarjs/no-angular-bypass-sanitization
        const safeUrl = this.sanitizer.bypassSecurityTrustUrl(objectUrl);
        this.thumbnails.update((map) => new Map(map).set(assetId, safeUrl));
      } catch {
        // A row without its picture still has a name; the grid says so rather than failing.
      }
    }
  }

  /** Frees the pictures the grid was showing. */
  release(): void {
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls = [];
    this.thumbnails.set(new Map());
  }
}
