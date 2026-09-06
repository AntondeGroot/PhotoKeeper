import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { LightroomService } from '../lightroom.service';
import { AlbumGroup, Photo, ReviewStatus } from '../photo';
import { AssetMetaStore } from '../storage/review/asset-meta-store';
import { ReviewStore } from '../storage/review/review-store';
import { AlbumManifestStore, isFullyScanned } from '../storage/detection/album-manifest-store';
import { AssetMeta, StoredVerdict } from '../storage/photokeeper-db';

/** Statuses that mean the photo still has work outstanding, so its album is not finished. */
const UNFINISHED: ReviewStatus[] = ['backlog', 'toEdit', 'maybe'];

/**
 * Statuses that put a photo in front of you when the album's prints are chosen.
 *
 * `kept` counts, not just `toPrint`: keeping a photo says "it is good as it is", which is a verdict
 * on *editing* and never meant "not worth printing". Leaving it out made editing the only road to
 * paper, so the shots that came out right were the ones that could never be printed.
 */
const PRINTABLE: ReviewStatus[] = ['kept', 'toPrint'];

function toPhoto(id: string, meta: AssetMeta, album: string, verdict: StoredVerdict): Photo {
  return {
    id,
    name: meta.name,
    ext: meta.ext,
    album,
    taken: meta.taken,
    status: verdict.status,
    kind: 'photo',
    starred: false,
    // Verdicts stored before this choice existed have no field, and the default is to print.
    saveOnly: verdict.saveOnly ?? false,
  };
}

/**
 * Albums where every photo has been dealt with, together with the photos in them worth putting on
 * paper.
 *
 * An album belongs on the Prints tab when it is *finished* — nothing left to sort, nothing left to
 * edit, nothing still undecided. Ordering prints for an album you are halfway through means
 * ordering the wrong set, and re-ordering later is the expensive kind of mistake.
 *
 * Finished is judged against the album's *manifest*, not against the metadata index. The index only
 * holds the slice detection has covered, because the scan is incremental — so an album scanned a
 * third of the way through, whose scanned third happened to be decided, read as finished and was
 * offered for printing with the rest of it never having been seen. The manifest knows the album's
 * real population and how far the scan got, which are the two things that question needs.
 *
 * Every printable photo comes through, including the ones set aside as "just save". The choice is
 * made on this tab and has to stay changeable there — a photo that vanished the moment it was set
 * aside could never be brought back.
 *
 * Computed over the whole library rather than the day's deck. The deck holds fifteen units drawn at
 * random, so a deck-scoped view showed an album the moment one of its photos happened to be picked
 * and promoted — with the rest of the album untouched and invisible.
 */
@Injectable({ providedIn: 'root' })
export class FinishedAlbumsService {
  private readonly meta = inject(AssetMetaStore);
  private readonly manifests = inject(AlbumManifestStore);
  private readonly reviews = inject(ReviewStore);
  private readonly svc = inject(LightroomService);

  async load(): Promise<AlbumGroup[]> {
    const [meta, verdicts, manifests, albums] = await Promise.all([
      this.meta.getAll(),
      this.reviews.getVerdicts(),
      this.manifests.getAll(),
      firstValueFrom(this.svc.getAlbums()),
    ]);
    const albumName = new Map(albums.map((a) => [a.id, a.name]));

    const groups: AlbumGroup[] = [];
    for (const [albumId, manifest] of manifests) {
      // Not scanned to the end: what is known about this album is a prefix of it, and the photos
      // beyond the cursor have not been offered for review, let alone decided.
      if (!isFullyScanned(manifest)) continue;

      const name = albumName.get(albumId) ?? 'No album';
      const printable = this.printableIn(manifest.fingerprints, verdicts, meta, name);
      if (printable) groups.push({ album: name, photos: printable });
    }

    // By name: the store's own order follows whichever album was scanned first, which shifts as
    // albums are added and would reshuffle the tab for no reason the user can see.
    return groups.sort((a, b) => a.album.localeCompare(b.album));
  }

  /**
   * The photos of one album worth putting on paper — or null when the album is not finished.
   *
   * Null rather than an empty list, because "nothing left to print" and "not ready to be asked" are
   * different answers and the tab shows neither the same way. An asset with no verdict at all counts
   * as unfinished: it is in the album's population and nobody has looked at it.
   */
  private printableIn(
    population: readonly { id: string }[],
    verdicts: ReadonlyMap<string, StoredVerdict>,
    meta: ReadonlyMap<string, AssetMeta>,
    album: string,
  ): Photo[] | null {
    const printable: Photo[] = [];
    for (const { id } of population) {
      const verdict = verdicts.get(id);
      const status = verdict?.status ?? 'backlog';
      if (UNFINISHED.includes(status)) return null;
      const asset = meta.get(id);
      if (verdict && asset && PRINTABLE.includes(status)) {
        printable.push(toPhoto(id, asset, album, verdict));
      }
    }
    return printable.length > 0 ? printable : null;
  }
}
