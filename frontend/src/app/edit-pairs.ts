import { PhotoAsset } from './lightroom-types';
import { splitFileName } from './photo';

/**
 * Suffixes Lightroom appends when it writes an edit beside the original: `DSC_1878.NEF` gains a
 * `DSC_1878-Enhanced-NR.dng`. Deliberately not `-Pano` or `-HDR` — those are merges of *several*
 * originals, so neither one of them is "the same shot" the way a denoise or an edit is.
 */
export const EDIT_SUFFIX = /-(Enhanced-NR|Enhanced|Edit)$/i;

/** The display name + original extension of an asset, from its import filename (falling back to id). */
export function splitAsset(asset: PhotoAsset): { name: string; ext?: string } {
  return splitFileName(asset.payload?.importSource?.fileName ?? asset.id);
}

/** The least a file has to say for a pair to be recognised: which file it is, and what it is called. */
export interface NamedFile {
  id: string;
  /** Display name without the extension, e.g. `DSC_1878-Enhanced-NR`. */
  name: string;
}

/**
 * Maps each edit's id to the id of the original it was derived from, matching on the filename stem.
 *
 * Only pairs an edit whose original is in the same set: a denoise that arrived without its original
 * is simply a photograph, and there is nothing to fold it into.
 *
 * Over names rather than assets, so the stored per-asset metadata can be matched with the same rule
 * the album listing is — one description of what makes a pair, whatever shape the caller holds.
 */
export function pairEditsToOriginals(files: Iterable<NamedFile>): Map<string, string> {
  const all = [...files];
  const byStem = new Map<string, string>();
  for (const file of all) {
    if (!EDIT_SUFFIX.test(file.name)) byStem.set(file.name.toLowerCase(), file.id);
  }
  const pairs = new Map<string, string>();
  for (const file of all) {
    const stem = file.name.replace(EDIT_SUFFIX, '');
    if (stem === file.name) continue; // not an edit
    const original = byStem.get(stem.toLowerCase());
    if (original !== undefined) pairs.set(file.id, original);
  }
  return pairs;
}

/** The same pairing over a catalogue listing, handing back the original asset itself. */
export function editPairs(assets: readonly PhotoAsset[]): Map<string, PhotoAsset> {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const named = assets.map((a) => ({ id: a.id, name: splitAsset(a).name }));
  const pairs = new Map<string, PhotoAsset>();
  for (const [editId, originalId] of pairEditsToOriginals(named)) {
    const original = byId.get(originalId);
    if (original) pairs.set(editId, original);
  }
  return pairs;
}

/**
 * The edits in a set that have their original beside them — the files detection must not look at.
 *
 * An edit shares its original's capture time exactly, comes from the same camera and is
 * near-identical pixel-wise, so it satisfies every criterion the burst detector has. Left in, the
 * pair is clustered and the shot arrives as "which is better, A or B?" — a duel between a photograph
 * and its own denoise, which is not a question anybody can answer. Worse, the grouping then outranks
 * the before/after card these two are meant to become, because a grouped asset never reaches the
 * pairing at all.
 *
 * An edit with no original present is left alone: nothing about it is a duplicate of anything.
 */
export function editsWithOriginal(assets: readonly PhotoAsset[]): ReadonlySet<string> {
  return new Set(editPairs(assets).keys());
}
