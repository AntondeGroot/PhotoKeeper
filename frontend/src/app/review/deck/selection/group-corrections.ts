import { DetectedGroup, PanoOrientation } from '../../../detection/detectors/detection-types';
import { coversSameGroup } from '../../../detection/detectors/group-identity';

/** The three kinds of user correction a stored group can carry. */
export interface GroupCorrections {
  dissolved: { memberIds: string[] }[];
  reclassified: {
    memberIds: string[];
    type: DetectedGroup['type'];
    orientation?: PanoOrientation;
  }[];
  memberships: { memberIds: string[]; frameIds: string[] }[];
}

/**
 * One stored group as the user has corrected it, or null when they dissolved it.
 *
 * Corrections follow the group they were made about even if re-detection shifted it by a frame — see
 * coversSameGroup. A dissolved group ("not a burst") drops out entirely; its members fall through to
 * singles.
 */
function applyCorrections(
  group: DetectedGroup,
  { dissolved, reclassified, memberships }: GroupCorrections,
): DetectedGroup | null {
  if (dissolved.some((o) => coversSameGroup(o.memberIds, group.memberIds))) return null;
  // A reclassified group is re-typed before hydration ("this burst is actually a pano").
  const reclass = reclassified.find((r) => coversSameGroup(r.memberIds, group.memberIds));
  const retyped = reclass
    ? { ...group, type: reclass.type, orientation: reclass.orientation }
    : group;
  // A membership correction says what the group actually consists of ("the pano is missing frames").
  // Applied last, and to the *detected* member set: it is keyed by what detection found, so
  // re-running detection finds the same correction again.
  const members = memberships.find((m) => coversSameGroup(m.memberIds, group.memberIds));
  return members ? { ...retyped, memberIds: members.frameIds } : retyped;
}

/**
 * Groups the user asserted where detection had found none at all.
 *
 * A membership correction usually adjusts a group that exists — "this sweep is missing frames" —
 * and {@link applyCorrections} finds it by the members detection reported. One made about a lone
 * photograph has nothing to attach to: a frame of a grid-pattern sweep that detection never
 * grouped is a single photo, and a correction filed against it would be looked for among groups
 * and never found. So it is turned back into a group here, and the assertion survives a re-scan
 * the same way a correction does.
 *
 * Only memberships no group claimed are considered, so a correction is never counted twice.
 */
function assertedGroups(
  { memberships, reclassified }: GroupCorrections,
  claimed: readonly string[][],
  metaById: ReadonlyMap<string, { albumId: string }>,
): DetectedGroup[] {
  const groups: DetectedGroup[] = [];
  for (const { memberIds, frameIds } of memberships) {
    if (claimed.some((members) => coversSameGroup(memberIds, members))) continue;
    if (frameIds.length < 2) continue;
    // The album the frames actually came out of; without metadata for them there is nowhere to put
    // the group, and the photos fall through as singles exactly as they did before.
    const albumId = frameIds.map((id) => metaById.get(id)?.albumId).find((id) => id !== undefined);
    if (albumId === undefined) continue;
    // What kind the user said it was, recorded beside the membership. A panorama when nothing says
    // otherwise: that was the only thing this could assert before bursts could be asserted too, and
    // an assertion made then should still come back as what it was.
    const said = reclassified.find((r) => coversSameGroup(r.memberIds, memberIds));
    groups.push({
      type: said?.type ?? 'pano',
      sourceAlbumId: albumId,
      memberIds: [...frameIds],
      ...(said?.type === 'burst' ? {} : { orientation: said?.orientation ?? 'horizontal' }),
    });
  }
  return groups;
}

/**
 * Every stored group as the user has corrected it, plus the groups they asserted from nothing.
 *
 * Kept as two lists because a caller may treat them differently: the deck re-types a stereo album's
 * detected groups, and an asserted group already says what it is.
 */
export function correctedGroups(
  groups: readonly DetectedGroup[],
  corrections: GroupCorrections,
  metaById: ReadonlyMap<string, { albumId: string }>,
): { detected: DetectedGroup[]; asserted: DetectedGroup[] } {
  const claimed = groups
    .filter((group) =>
      corrections.memberships.some((m) => coversSameGroup(m.memberIds, group.memberIds)),
    )
    .map((group) => group.memberIds);
  return {
    detected: groups.flatMap((group) => applyCorrections(group, corrections) ?? []),
    asserted: assertedGroups(corrections, claimed, metaById),
  };
}
