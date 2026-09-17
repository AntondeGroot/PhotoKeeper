import { EDIT_SUFFIX } from '../edit-pairs';
import { mergeSourceNames } from '../review/merged-photo';

/**
 * Which files are the same photograph.
 *
 * Lightroom leaves several files behind for one shot, and the app has been asking about each of them
 * in turn: a photograph and the denoise written beside it, a sweep and the panorama stitched from it,
 * both eyes of a stereo pair. Sorting them separately is right — each is a file you might or might
 * not keep — but *tagging* them separately is nonsense. A tag is about what is in the picture, and
 * they are all pictures of the same thing.
 *
 * Three ways one shot shows itself, all used together:
 *
 * - **the name**, where Lightroom derived one file from another (`DSC_1.NEF` → `DSC_1-Enhanced-NR`,
 *   `DSC_1-Pano`, `DSC_1-HDR-Pano`);
 * - **a detected group**, which is what a burst, a sweep or a stereo pair is;
 * - **a recorded merge**, which says outright which frames became which photograph.
 */

/** Everything the grouping is worked out from. */
export interface ShotSources {
  /** Display name per asset, without the extension. */
  names: ReadonlyMap<string, string>;
  /** Detected or asserted groups: bursts, sweeps, stereo sets. */
  groups: Iterable<readonly string[]>;
  /** Recorded merges: the merged photograph together with the frames behind it. */
  merges: Iterable<readonly string[]>;
}

/**
 * Every asset mapped to the files that are the same photograph as it, itself included.
 *
 * Built by joining: a file linked to any member of a shot belongs to the whole of it, so a sweep,
 * its panorama and the denoise of one of its frames end up as one set rather than three.
 */
export function shotSets(sources: ShotSources): Map<string, string[]> {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = parent.get(id) ?? id;
    while (root !== (parent.get(root) ?? root)) root = parent.get(root) ?? root;
    parent.set(id, root);
    return root;
  };
  const join = (a: string, b: string): void => {
    const [rootA, rootB] = [find(a), find(b)];
    if (rootA !== rootB) parent.set(rootA, rootB);
  };

  for (const id of sources.names.keys()) parent.set(id, parent.get(id) ?? id);
  for (const members of sources.groups) linkAll(members, join);
  for (const members of sources.merges) linkAll(members, join);

  // What a name says was derived from what. Every ancestor is offered, so a panorama stitched from
  // brackets joins the HDR it came from where that exists and the frames where it does not.
  const idByName = new Map<string, string>();
  for (const [id, name] of sources.names) idByName.set(name.toLowerCase(), id);
  for (const [id, name] of sources.names) {
    for (const source of derivedFrom(name)) {
      const parentId = idByName.get(source.toLowerCase());
      if (parentId !== undefined) join(id, parentId);
    }
  }

  const sets = new Map<string, string[]>();
  for (const id of parent.keys()) {
    const root = find(id);
    sets.set(root, [...(sets.get(root) ?? []), id]);
  }

  const byAsset = new Map<string, string[]>();
  for (const id of parent.keys()) byAsset.set(id, sets.get(find(id)) ?? [id]);
  return byAsset;
}

/** The names a file could have been derived from: an edit of one, or a merge of several. */
function derivedFrom(name: string): string[] {
  const edited = EDIT_SUFFIX.test(name) ? [name.replace(EDIT_SUFFIX, '')] : [];
  return [...edited, ...mergeSourceNames(name)];
}

function linkAll(members: readonly string[], join: (a: string, b: string) => void): void {
  for (const member of members.slice(1)) join(members[0], member);
}
