import { Injectable, inject } from '@angular/core';
import { PreferencesService } from '../preferences.service';
import { StereoRole } from '../detection/detectors/detection-types';
import { CatalogScanService } from '../detection/scan/catalog-scan.service';
import { ReviewDecisionsService } from './review-decisions.service';
import { ReviewBufferService } from './review-buffer.service';

/** The order the controls cycle through: not stereo → both eyes → left eyes → right eyes → not stereo. */
const CYCLE: (StereoRole | null)[] = [null, 'both', 'left', 'right'];

/**
 * Pill wording per role. Kept together so the album manager's narrow rows and the roomier in-review
 * chip cannot drift into describing the same mark differently.
 */
export const STEREO_ROLE_LABEL: Record<StereoRole, { short: string; long: string }> = {
  both: { short: 'Stereo L+R', long: 'Stereo · both eyes' },
  left: { short: 'Stereo L', long: 'Stereo · left eyes' },
  right: { short: 'Stereo R', long: 'Stereo · right eyes' },
};

/**
 * An album's stereo marking: its role, and — when the eyes were imported into two albums — which
 * album holds the other half.
 *
 * Both places a mark can be made (the album manager, the chip above the review card) write the same
 * name-keyed preferences and owe the same follow-ups, which is why they share this rather than each
 * remembering them.
 */
@Injectable({ providedIn: 'root' })
export class StereoAlbumsService {
  private readonly prefs = inject(PreferencesService);
  private readonly catalogScan = inject(CatalogScanService);
  private readonly decisions = inject(ReviewDecisionsService);
  private readonly buffer = inject(ReviewBufferService);

  /** The album's role, or null when it is not a stereo album at all. */
  role(album: string | null): StereoRole | null {
    return album ? (this.prefs.stereoAlbumRoles()[album] ?? null) : null;
  }

  /** Moves the album to the next role in the cycle — what both controls do when tapped. */
  cycle(album: string): void {
    const next = CYCLE[(CYCLE.indexOf(this.role(album)) + 1) % CYCLE.length];
    this.setRole(album, next);
  }

  /** Marks (or unmarks) the album, then clears everything the change made stale. */
  setRole(album: string, role: StereoRole | null): void {
    this.prefs.stereoAlbumRoles.update((roles) => {
      const next = { ...roles };
      if (role) next[album] = role;
      else delete next[album];
      return next;
    });
    this.pruneLinks(album, role);
    this.regroup([album]);
  }

  /** The right album paired with this left one, or null while it has no other half. */
  partner(leftAlbum: string): string | null {
    return this.prefs.stereoPartners()[leftAlbum] ?? null;
  }

  /** The left album that claims this right one, or null while nothing does. */
  claimant(rightAlbum: string): string | null {
    const pair = Object.entries(this.prefs.stereoPartners()).find(([, r]) => r === rightAlbum);
    return pair?.[0] ?? null;
  }

  /** Albums marked as holding right eyes — the candidates a left album can be paired with. */
  rightAlbums(): string[] {
    return Object.entries(this.prefs.stereoAlbumRoles())
      .filter(([, role]) => role === 'right')
      .map(([album]) => album)
      .sort((a, b) => a.localeCompare(b));
  }

  /**
   * Names the right album that holds this left album's other eye (or clears the pairing).
   *
   * A right album can only be claimed once, so naming one takes it off whichever left album had it —
   * two left albums pointing at the same right album would pair every right frame twice, and no
   * screen could show which claim was the real one.
   *
   * Both sides are re-grouped afterwards, for the same reason a role change is: what is queued and
   * what is on today's deck were drawn when these albums were unrelated.
   */
  setPartner(leftAlbum: string, rightAlbum: string | null): void {
    const previous = this.partner(leftAlbum);
    const displaced = rightAlbum ? this.claimant(rightAlbum) : null;
    this.prefs.stereoPartners.update((pairs) => {
      const next = Object.fromEntries(
        Object.entries(pairs).filter(([left, right]) => left !== leftAlbum && right !== rightAlbum),
      );
      if (rightAlbum) next[leftAlbum] = rightAlbum;
      return next;
    });
    this.regroup([leftAlbum, rightAlbum, previous, displaced]);
  }

  /**
   * What every change to a stereo marking owes the rest of the app.
   *
   * A marking changes how an album's frames are *grouped*, while changing none of its assets — so
   * everything downstream is holding a grouping that no longer exists, and nothing else would ever
   * tell it:
   *
   * - the scan's change gate compares assets, sees no difference and skips the album forever, so its
   *   manifest is dropped to make the next pass look again;
   * - the standing queue is a snapshot two hundred units deep, served before anything freshly
   *   sampled, so the album's units are dropped from it;
   * - today's deck holds units drawn the same way, so the album's undecided ones are withdrawn.
   *   Judging a lone eye is the thing this is really protecting against: the verdict would keep that
   *   frame out of every later selection, so the pair could never be shown whole.
   */
  private regroup(albums: readonly (string | null)[]): void {
    const names = [...new Set(albums.filter((album): album is string => !!album))];
    for (const album of names) {
      void this.catalogScan.invalidateAlbumByName(album);
      this.decisions.withdrawAlbum(album);
    }
    void this.buffer.dropAlbums(names);
  }

  /**
   * Drops the pairings a role change has invalidated: an album that no longer holds left eyes has no
   * other half to name, and one that no longer holds right eyes cannot be anybody's other half. Left
   * behind, either would keep pairing frames that are no longer eyes of anything.
   */
  private pruneLinks(album: string, role: StereoRole | null): void {
    if (role === 'left') return;
    this.prefs.stereoPartners.update((pairs) =>
      Object.fromEntries(
        Object.entries(pairs).filter(
          ([left, right]) => left !== album && (role === 'right' || right !== album),
        ),
      ),
    );
  }
}
