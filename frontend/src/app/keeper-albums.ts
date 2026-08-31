/**
 * The Lightroom albums Keeper files decisions into, and how to reach them.
 *
 * The user has to create these themselves, as normal albums: the partner API cannot create albums,
 * and cannot write ratings or flags at all, so album membership is the only durable write-back there
 * is (see the top-level README, "Lightroom write-back").
 *
 * Pure, and deliberately not inside a component: both the setup notice and the Edit step need to
 * know whether these exist, and a component cannot be the place either of them asks.
 */

export interface RequiredAlbum {
  readonly name: string;
  readonly purpose: string;
}

/** The album the Edit step sends you to — where everything flagged "to edit" is filed. */
export const KEEPER_EDIT_ALBUM = 'KeeperEdit';

export const REQUIRED_ALBUMS: readonly RequiredAlbum[] = [
  { name: KEEPER_EDIT_ALBUM, purpose: 'photos you want to edit' },
  { name: 'KeeperDelete', purpose: 'photos you want to delete' },
  { name: 'KeeperPrint', purpose: 'photos you want to print' },
];

/**
 * Deep-link to an album in the Lightroom web app.
 *
 * Unlike a single asset — which the web app only routes to via *search* (see `lightroomUrl` in the
 * Edit list) — an album has a real path of its own, so this is the plain one.
 */
export function lightroomAlbumUrl(catalogId: string, albumId: string): string {
  return `https://lightroom.adobe.com/libraries/${catalogId}/albums/${albumId}/assets`;
}
