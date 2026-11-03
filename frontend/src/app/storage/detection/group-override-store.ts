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

  /**
   * Forgets a dissolve, so the group forms again as detection sees it.
   *
   * For undo: taking back the decision that dissolved a group has to take back the dissolve too, or
   * the frames stay singles for ever and the unit the user just got back could never be drawn again.
   */
  async restore(memberIds: string[]): Promise<void> {
    await (await this.db.open()).delete('groupOverrides', groupSignature(memberIds));
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
