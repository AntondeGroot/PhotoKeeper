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

/**
 * The album a confirmed print set is sent to, and the prefix that makes another one.
 *
 * There is always at least this one bin, because setup asks for it. Anything else the user names
 * after it — "KeeperPrint 2", "KeeperPrint December" — is another bin, so having more than one order
 * in flight costs a new album in Lightroom and no setting here. Discovered rather than configured:
 * the API cannot create albums, so the catalogue is the only thing that knows how many there are.
 */
export const KEEPER_PRINT_ALBUM = 'KeeperPrint';

/**
 * Whether a photo still belongs in the print bin it was sent to.
 *
 * A bin is a snapshot of one order, so a photo does not stop belonging merely because the order was
 * placed. It stops belonging when the decision behind it is withdrawn — the edit was undone, the
 * photo was rejected, or it was set aside on the Prints tab as one to keep but not print. In each of
 * those the bin now holds something the user has said they do not want printed, and only they can
 * take it out.
 *
 * Takes the parts rather than the stored verdict, so this stays a pure statement about a decision
 * and the domain layer keeps no dependency on the shape of the database.
 */
export function belongsInPrintBin(status: string, saveOnly: boolean): boolean {
  return !saveOnly && (status === 'kept' || status === 'toPrint');
}

/** Whether an album is one of the print bins. */
export function isPrintBin(name: string): boolean {
  return name.startsWith(KEEPER_PRINT_ALBUM);
}

/** The catalogue's print bins, in name order — which is the order they are filled. */
export function printBinsIn(names: Iterable<string>): string[] {
  return [...names].filter(isPrintBin).sort((a, b) => a.localeCompare(b));
}

/** The album a decided photo belongs in, or null when the verdict files nowhere. */
export function albumForVerdict(status: string): string | null {
  return VERDICT_ALBUMS[status] ?? null;
}

/**
 * Where each verdict is filed automatically.
 *
 * `kept` deliberately files nowhere: keeping a photograph *is* leaving it where it is, and an album
 * of "photos I decided to keep" would be a copy of the catalogue. `maybe` files nowhere for the
 * opposite reason — it is the absence of a decision, and writing it out would put an undecided photo
 * somewhere that looks decided.
 *
 * `toPrint` files nowhere *now*. It used to go to KeeperPrint the moment a photo was promoted while
 * editing, which is several steps before the print set is known: the set is chosen on the Prints tab
 * afterwards, over a finished album, and includes kept photos as well as promoted ones. Since a
 * photo cannot be taken out of an album again, every one promoted and later set aside as "just save"
 * was stuck in KeeperPrint for good. The print set is now sent deliberately, once, from that tab.
 */
const VERDICT_ALBUMS: Record<string, string> = {
  rejected: 'KeeperDelete',
  toEdit: KEEPER_EDIT_ALBUM,
};

export const REQUIRED_ALBUMS: readonly RequiredAlbum[] = [
  { name: KEEPER_EDIT_ALBUM, purpose: 'photos you want to edit' },
  { name: 'KeeperDelete', purpose: 'photos you want to delete' },
  { name: KEEPER_PRINT_ALBUM, purpose: 'photos you want to print' },
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
 * One deep link per batch of filenames, so a long list still fits in URLs a browser will follow.
 *
 * Batched rather than truncated: the point of the link is to put the user in front of *the* photos
 * that need removing, and a link that quietly showed the first forty of sixty would leave twenty
 * behind with nothing to say so.
 */
export function albumSearchLinks(
  catalogId: string,
  albumId: string,
  names: readonly string[],
): string[] {
  const links: string[] = [];
  for (let i = 0; i < names.length; i += SEARCH_TERMS_PER_LINK) {
    links.push(
      lightroomAlbumSearchUrl(catalogId, albumId, names.slice(i, i + SEARCH_TERMS_PER_LINK)),
    );
  }
  return links;
}

/**
 * Deep-link to one asset in the Lightroom web app.
 *
 * The web app routes to a single asset via *search* — the `/search/assets/<id>` path plus a `q` that
 * names the file — rather than a plain `/assets/<id>` path, which 404s. The id is in the path, which
 * is what makes this reliable where a name search is not: proved against a real catalogue on a photo
 * that an album search could not find under any form of its name, while this opened it directly.
 */
export function lightroomAssetUrl(catalogId: string, assetId: string, fileName: string): string {
  const base = `https://lightroom.adobe.com/libraries/${catalogId}/search/assets/${assetId}`;
  return `${base}?q=${encodeURIComponent(fileName)}`;
}

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
