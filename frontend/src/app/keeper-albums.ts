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

/** The album a decided photo belongs in, or null when the verdict files nowhere. */
export function albumForVerdict(status: string): string | null {
  return VERDICT_ALBUMS[status] ?? null;
}

/**
 * Where each verdict is filed.
 *
 * `kept` deliberately files nowhere: keeping a photograph *is* leaving it where it is, and an album
 * of "photos I decided to keep" would be a copy of the catalogue. `maybe` files nowhere for the
 * opposite reason — it is the absence of a decision, and writing it out would put an undecided photo
 * somewhere that looks decided.
 */
const VERDICT_ALBUMS: Record<string, string> = {
  rejected: 'KeeperDelete',
  toEdit: KEEPER_EDIT_ALBUM,
  toPrint: 'KeeperPrint',
};

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

/** How many filenames one tidy-up link carries, so the URL stays inside what browsers accept. */
export const SEARCH_TERMS_PER_LINK = 40;

/**
 * Deep-link into an album showing only the photos whose names are listed.
 *
 * The web app scopes a search to one album with `albumFilter`, and takes a comma-separated list of
 * terms as an OR — both established by trying them against a real catalogue rather than by reading
 * documentation, which does not cover these routes. (`OR` works too; a pipe does not.)
 *
 * This is what makes tidying up possible at all. The partner scope cannot remove a photo from an
 * album, so the app cannot undo its own filing — but it can put the user in front of exactly the
 * photos that need removing, where two clicks does the lot.
 */
export function lightroomAlbumSearchUrl(
  catalogId: string,
  albumId: string,
  names: readonly string[],
): string {
  const query = encodeURIComponent(names.join(','));
  return (
    `https://lightroom.adobe.com/libraries/${catalogId}/search/assets` +
    `?albumFilter=${albumId}&q=${query}&tab=photos`
  );
}
