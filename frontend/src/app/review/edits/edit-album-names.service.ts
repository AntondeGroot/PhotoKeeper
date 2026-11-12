import { Injectable, signal } from '@angular/core';
import { PhotoAsset } from '../../lightroom-types';
import { splitFileName } from '../../photo';

/** A photograph's name as Lightroom shows it, and its file type. */
export interface ListedName {
  name: string;
  ext?: string;
}

/**
 * The names of the photographs in KeeperEdit, as the last listing of the album gave them.
 *
 * <p>The Edit tab is built from the app's own records, and takes names from the scan's metadata. A
 * photograph the scan has not reached has no name there, so its row showed a 32-digit asset id — no
 * use for picking out what to edit, nor for finding it in Lightroom. The album listing carries the
 * file name of every photograph in it, and the app lists KeeperEdit on every load anyway to count
 * it, so the names are already in hand; this is where they are kept.
 *
 * <p>In memory only. Until the first listing of a session answers, a row can still show an id; it is
 * named a moment later, which is better than adding a store for something a load fetches anyway.
 */
@Injectable({ providedIn: 'root' })
export class EditAlbumNamesService {
  readonly names = signal<ReadonlyMap<string, ListedName>>(new Map());

  /** Takes the names from a listing of the album. Tombstones name nothing anyone can edit. */
  note(held: readonly PhotoAsset[]): void {
    const names = new Map<string, ListedName>();
    for (const asset of held) {
      const fileName = asset.payload?.importSource?.fileName;
      if (asset.subtype !== 'deleted_image' && fileName) {
        names.set(asset.id, splitFileName(fileName));
      }
    }
    this.names.set(names);
  }
}
