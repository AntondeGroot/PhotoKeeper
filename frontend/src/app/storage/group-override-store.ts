import { Injectable, inject } from '@angular/core';
import { GroupOverride, PhotoKeeperDb } from './photokeeper-db';

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

  /** Signatures of every dissolved group, for filtering detected groups at selection time. */
  async signatures(): Promise<Set<string>> {
    return new Set(await (await this.db.open()).getAllKeys('groupOverrides'));
  }

  /** All recorded overrides — the labels a future "tighten detection?" suggestion would read. */
  async getAll(): Promise<GroupOverride[]> {
    return (await this.db.open()).getAll('groupOverrides');
  }
}
