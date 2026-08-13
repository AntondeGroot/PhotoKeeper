import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { LightroomService } from '../lightroom.service';
import { AlbumGroup, Photo, ReviewStatus } from '../photo';
import { AssetMetaStore } from '../storage/review/asset-meta-store';
import { ReviewStore } from '../storage/review/review-store';
import { AssetMeta } from '../storage/photokeeper-db';

/** Statuses that mean the photo still has work outstanding, so its album is not finished. */
const UNFINISHED: ReviewStatus[] = ['backlog', 'toEdit', 'maybe'];

function toPhoto(id: string, meta: AssetMeta, album: string): Photo {
  return {
    id,
    name: meta.name,
    ext: meta.ext,
    album,
    taken: meta.taken,
    status: 'toPrint',
    kind: 'photo',
    starred: false,
    keepsake: false,
  };
}

/**
 * Albums where every photo has been dealt with and at least one is waiting to be printed.
 *
 * An album belongs on the Prints tab when it is *finished* — nothing left to sort, nothing left to
 * edit, nothing still undecided. Ordering prints for an album you are halfway through means
 * ordering the wrong set, and re-ordering later is the expensive kind of mistake.
 *
 * Computed over the whole library rather than the day's deck. The deck holds fifteen units drawn at
 * random, so a deck-scoped view showed an album the moment one of its photos happened to be picked
 * and promoted — with the rest of the album untouched and invisible.
 */
@Injectable({ providedIn: 'root' })
export class FinishedAlbumsService {
  private readonly meta = inject(AssetMetaStore);
  private readonly reviews = inject(ReviewStore);
  private readonly svc = inject(LightroomService);

  async load(): Promise<AlbumGroup[]> {
    const [meta, verdicts, albums] = await Promise.all([
      this.meta.getAll(),
      this.reviews.getVerdicts(),
      firstValueFrom(this.svc.getAlbums()),
    ]);
    const albumName = new Map(albums.map((a) => [a.id, a.name]));

    const ready = new Map<string, Photo[]>();
    const blocked = new Set<string>();
    for (const [id, asset] of meta) {
      const status = verdicts.get(id)?.status ?? 'backlog';
      if (UNFINISHED.includes(status)) {
        blocked.add(asset.albumId);
      } else if (status === 'toPrint') {
        const name = albumName.get(asset.albumId) ?? 'No album';
        ready.set(asset.albumId, [...(ready.get(asset.albumId) ?? []), toPhoto(id, asset, name)]);
      }
    }

    return (
      [...ready.entries()]
        .filter(([albumId]) => !blocked.has(albumId))
        .map(([albumId, photos]) => ({ album: photos[0].album ?? albumId, photos }))
        // By name: the map's own order follows whichever asset id came back first, which shifts as
        // photos are added and would reshuffle the tab for no reason the user can see.
        .sort((a, b) => a.album.localeCompare(b.album))
    );
  }
}
