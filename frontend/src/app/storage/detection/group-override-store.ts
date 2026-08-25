import { Injectable, inject } from '@angular/core';
import { GroupMembers, GroupOverride, GroupReclass, PhotoKeeperDb } from '../photokeeper-db';

/**
 * Order-independent key for a group's member set, so an override matches a re-detected group however
 * its frames are ordered. Used as the store key and to test detected groups against the overrides.
 */
export function groupSignature(memberIds: readonly string[]): string {
  return [...memberIds].sort((a, b) => a.localeCompare(b)).join('\n');
}

/**
 * Whether a correction recorded against `recorded` still applies to a re-detected group.
 *
 * <p>Matching on the exact member set was too brittle to keep a promise the store makes: re-detection
 * at a different threshold routinely shifts a group by a frame, and the correction then stopped
 * applying with no trace — the burst you already said was not a burst simply came back. Since the
 * burst-window setting re-detects the whole library, that was reachable by moving one slider.
 *
 * <p>So a correction follows the group it was made about rather than an exact set: it applies while
 * the two sets share more than half of everything they cover between them. Identical sets always
 * match (the previous behaviour), a group that gained or lost a frame still matches, and a genuinely
 * different group — sharing only a frame or two — does not, so a correction cannot spread.
 */
export function coversSameGroup(recorded: readonly string[], detected: readonly string[]): boolean {
  const inRecorded = new Set(recorded);
  const shared = new Set(detected.filter((id) => inRecorded.has(id))).size;
  const union = inRecorded.size + new Set(detected).size - shared;
  return union > 0 && shared * 2 > union;
}

/**
 * Device-local record of "this is not a group" user corrections. Selection drops any detected group
 * whose member set is here (its frames fall back to singles), so a dissolve survives both reloads and
 * re-scans. Detection stays pure — it still stores the group; selection is where the override applies.
 */
@Injectable({ providedIn: 'root' })
export class GroupOverrideStore {
  private readonly db = inject(PhotoKeeperDb);

  async dissolve(override: GroupOverride): Promise<void> {
    await (
      await this.db.open()
    ).put('groupOverrides', override, groupSignature(override.memberIds));
  }

  /** All recorded overrides — the labels a future "tighten detection?" suggestion would read. */
  async getAll(): Promise<GroupOverride[]> {
    return (await this.db.open()).getAll('groupOverrides');
  }

  /** Records "this group is actually a burst/pano" so selection re-types it across reloads + re-scans. */
  async reclassify(reclass: GroupReclass): Promise<void> {
    await (await this.db.open()).put('groupReclass', reclass, groupSignature(reclass.memberIds));
  }

  /**
   * Every type correction, for matching against detected groups at selection time.
   *
   * <p>Returned as records rather than keyed by signature: the match is {@link coversSameGroup}, not
   * an exact-key lookup, so the caller needs each correction's member set.
   */
  async reclassifications(): Promise<GroupReclass[]> {
    return (await this.db.open()).getAll('groupReclass');
  }

  /**
   * Records what a group actually consists of, after the user added the frames detection missed (or
   * took one out). Keyed by the *detected* member set, so the correction is found again by the group
   * it was made about rather than by what it was corrected into.
   */
  async setMembers(members: GroupMembers): Promise<void> {
    await (await this.db.open()).put('groupMembers', members, groupSignature(members.memberIds));
  }

  /** Every membership correction, for matching against detected groups at selection time. */
  async memberships(): Promise<GroupMembers[]> {
    return (await this.db.open()).getAll('groupMembers');
  }
}
