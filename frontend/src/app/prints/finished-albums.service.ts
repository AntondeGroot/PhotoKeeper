import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { LightroomService } from '../lightroom.service';
import { AlbumGroup, Photo, ReviewStatus } from '../photo';
import { AssetMetaStore } from '../storage/review/asset-meta-store';
import { ReviewStore } from '../storage/review/review-store';
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
      const verdict = verdicts.get(id);
      const status = verdict?.status ?? 'backlog';
      if (UNFINISHED.includes(status)) {
        blocked.add(asset.albumId);
      } else if (verdict && PRINTABLE.includes(status)) {
        const name = albumName.get(asset.albumId) ?? 'No album';
        ready.set(asset.albumId, [
          ...(ready.get(asset.albumId) ?? []),
          toPhoto(id, asset, name, verdict),
        ]);
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
