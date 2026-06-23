/**
 * Where an album sits in the print → place journey, keyed by album name. Absent = still "To print"
 * (needs exporting/ordering). 'ordered' = ordered, sitting in "Done" awaiting placement (the checkmark).
 * 'placed' = arrived and on the wall / in an album — complete, so it stops showing and stops nudging.
 */
export type AlbumPrintState = 'ordered' | 'placed';
