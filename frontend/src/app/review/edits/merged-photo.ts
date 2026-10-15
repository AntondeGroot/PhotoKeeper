/**
 * Recognising the photograph Lightroom writes when it merges several into one.
 *
 * A merge is a *new photograph* — a new asset, with a name of its own — and that is what makes it
 * invisible to the edit check. That check asks whether a photo has changed since it was sent off,
 * and the sources of a merge never change: Lightroom leaves them exactly as they were and puts the
 * result beside them. So a sweep sent to edit stayed in the queue for ever, reported untouched,
 * while the finished photograph sat in the catalogue unreviewed and unprintable.
 *
 * The name is the link. Lightroom takes one of the sources and adds a suffix: `DSC_6470.NEF` and its
 * neighbours become `DSC_6470-Pano.dng`; a bracket becomes `DSC_6470-HDR.dng`; brackets stitched
 * into a sweep become `DSC_6470-HDR-Pano.dng`. Merge the same photographs twice and the second is
 * numbered, `DSC_6470-Pano-2`.
 */

/** One suffix Lightroom appends, with the number it adds when the same merge is made twice. */
const MERGE_SUFFIX = /-(HDR|Pano)(?:-(\d+))?$/i;

/** What kind of photograph a merge produced, in the words the app uses for it. */
export type MergeKind = 'panorama' | 'HDR photo' | 'HDR panorama';

/** One frame, and the merge it can be recognised by. */
export interface NamedAsset {
  id: string;
  /** Display name without the extension, e.g. `DSC_6470-HDR-Pano`. */
  name: string;
}

/** A merged photograph and the frames it was made from. */
export interface MergedPhoto {
  /** The merge — what gets printed and looked at from now on. */
  mergedId: string;
  mergedName: string;
  /** What it is, for a screen that has to name it. */
  kind: MergeKind;
  /**
   * The photographs it came from, which stay in the library as the originals.
   *
   * The whole set where the app knows it as a group, and just the named frame where it does not —
   * a merge of photographs detection never grouped still links back to the one Lightroom named.
   */
  frameIds: readonly string[];
}

/** What a merged name says it is, or null when this is not a merge at all. */
export function mergeKind(name: string): MergeKind | null {
  const suffixes = suffixesOf(name);
  if (suffixes.length === 0) return null;
  const hdr = suffixes.includes('hdr');
  const pano = suffixes.includes('pano');
  if (hdr && pano) return 'HDR panorama';
  return hdr ? 'HDR photo' : 'panorama';
}

/**
 * The names a merge could have been made from, longest first.
 *
 * More than one, because the suffixes stack and the steps can be separate photographs. Brackets
 * stitched into a sweep are named `DSC_6470-HDR-Pano`, and whether `DSC_6470-HDR` exists depends on
 * how it was done: merged in two passes it is a photograph in its own right and the true source,
 * merged in one it never existed and the source is the bracket frame `DSC_6470`. Offering both, in
 * that order, lets the caller take whichever the library actually holds.
 */
export function mergeSourceNames(name: string): string[] {
  const names: string[] = [];
  let stem = name;
  let match = MERGE_SUFFIX.exec(stem);
  while (match) {
    stem = stem.slice(0, match.index);
    names.push(stem);
    match = MERGE_SUFFIX.exec(stem);
  }
  return names;
}

/** Every suffix on a merged name, innermost last, lower-cased. */
function suffixesOf(name: string): string[] {
  const suffixes: string[] = [];
  let stem = name;
  let match = MERGE_SUFFIX.exec(stem);
  while (match) {
    suffixes.push(match[1].toLowerCase());
    stem = stem.slice(0, match.index);
    match = MERGE_SUFFIX.exec(stem);
  }
  return suffixes;
}

/**
 * The merges among these files, paired with the photographs each was made from.
 *
 * Only merges whose sources are actually waiting to be edited are reported. A panorama merged long
 * before the app knew about it — or one whose frames were never sent off — is simply a photograph in
 * the library, and offering to "finish" it would be inventing work nobody asked for.
 */
export function findMerges(
  files: Iterable<NamedAsset>,
  isQueued: (assetId: string) => boolean,
  framesOf: (assetId: string) => readonly string[] | undefined,
): MergedPhoto[] {
  const all = [...files];
  const byName = new Map(all.map((file) => [file.name.toLowerCase(), file]));

  const merges: MergedPhoto[] = [];
  for (const file of all) {
    const kind = mergeKind(file.name);
    if (kind === null) continue;
    // The photograph Lightroom named it after — the nearest one the library actually holds, so a
    // two-pass merge links to the HDR it was stitched from rather than past it to the brackets.
    const source = mergeSourceNames(file.name)
      .map((name) => byName.get(name.toLowerCase()))
      .find((found) => found !== undefined);
    if (!source) continue;

    const frameIds = framesOf(source.id) ?? [source.id];
    if (!frameIds.some(isQueued)) continue;
    merges.push({ mergedId: file.id, mergedName: file.name, kind, frameIds });
  }
  return merges;
}
