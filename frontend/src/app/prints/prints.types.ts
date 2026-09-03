import { AlbumGroup, Photo } from '../photo';

/**
 * Where an album sits in the print → place journey, keyed by album name. Absent = still "To print"
 * (needs exporting/ordering). 'ordered' = ordered, sitting in "Done" awaiting placement (the checkmark).
 * 'placed' = arrived and on the wall / in an album — complete, so it stops showing and stops nudging.
 */
export type AlbumPrintState = 'ordered' | 'placed';

/**
 * The photos in a finished album that will actually be ordered: everything except the ones set
 * aside as "keep it, don't print it". Printing is the default, so this is the whole album minus its
 * exceptions.
 */
export function printsIn(group: AlbumGroup): Photo[] {
  return group.photos.filter((photo) => !photo.saveOnly);
}
