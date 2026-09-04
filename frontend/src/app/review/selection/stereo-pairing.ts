import { PhotoAsset } from '../../lightroom-types';
import { DetectedGroup, StereoRole } from '../../detection/detectors/detection-types';
import { StereoAlbumRef, StereoGap } from '../../photo';
import { FrameSignature } from '../../detection/detectors/detection-types';
import { EyeFrame, EyePairOptions, pairEyes } from '../../detection/detectors/stereo-pairs';

/** What an album's stereo marking does to the material selection works over. */
export interface StereoPairing {
  /** Stereo groups to add, keyed by the left album — the album that owns the pair. */
  groups: Map<string, DetectedGroup[]>;
  /** Right-eye assets to hand to the left album, so hydration can reach both halves of a pair. */
  extraAssets: Map<string, PhotoAsset[]>;
  /** Albums that must never be offered on their own: the right halves. */
  hiddenAlbumIds: Set<string>;
  /** Every frame that is a left eye, so hydration never has to guess which side is which. */
  leftEyeIds: Set<string>;
  /**
   * Frames whose other eye is known not to exist, and which eye that is — asset id → gap. Selection
   * turns each one into an incomplete-pair card rather than a photograph.
   */
  gaps: Map<string, StereoGap>;
  /**
   * Frames that have not paired *yet*, where the scan that would settle it has not finished. Kept
   * off the deck entirely until it has — neither a photograph nor a gap to report.
   */
  withheldIds: Set<string>;
}

export interface StereoPairingInput {
  roles: Record<string, StereoRole>;
  /** Left album name → right album name. */
  partners: Record<string, string>;
  albumIdByName: ReadonlyMap<string, string>;
  assetsByAlbum: ReadonlyMap<string, PhotoAsset[]>;
  /** Frame signatures — the only thing the matcher compares; see pairEyes. */
  signatures: ReadonlyMap<string, FrameSignature>;
  /** Frames detection has already placed in a group — in a both-eyes album, the ones that paired. */
  groupedIds: ReadonlySet<string>;
  /** Albums whose every image has been through detection, so what it found about them is final. */
  fullyScanned: ReadonlySet<string>;
  options?: EyePairOptions;
}

/**
 * Turns an album's stereo marking into what selection should do with its frames.
 *
 * Two shapes of stereo shoot, and one rule over both. A shoot **split across two albums** is
 * rebuilt here: every album marked as holding left eyes and paired with one holding right eyes is
 * matched frame to frame, and each match becomes a stereo group owned by the left album. An album
 * marked as holding **both eyes** was already paired by the in-album detector during the scan, and
 * needs nothing rebuilt.
 *
 * Nothing is stored. Pairing is not what caching detection is for — the expensive part of detection
 * is *finding* a group, and the cross-album rule is known up front, so the pair is rebuilt when the
 * queue is built rather than taught to every store and change-gate on the way (see
 * docs/track-b-detection.md, Slice 6).
 *
 * The rule over both shapes: **a frame of a stereo album is never offered as a photograph.** It is
 * half of one, and a verdict on a half would keep it out of every later selection, so the shot could
 * never be shown whole afterwards. What happens to a frame that did not pair depends on whether its
 * other eye is genuinely missing or merely not looked for yet:
 *
 * - **Known missing** — everything it could have paired with has been scanned, or there is no album
 *   to pair with at all — it becomes a {@link StereoGap}: an incomplete-pair card naming the eye
 *   that is absent and where it was looked for. Saying so out loud is the point. "No partner" is
 *   most often a pairing that was never set up, and holding those frames back in silence gave
 *   nobody a way to notice.
 * - **Not yet known** — the album, or its other half, is still being scanned a prefix at a time — it
 *   is withheld, and reported as nothing. An unfinished scan is not evidence of absence, and a card
 *   claiming a missing eye on the strength of one would be wrong far more often than right.
 */
export function pairStereoAlbums(input: StereoPairingInput): StereoPairing {
  const pairing: StereoPairing = {
    groups: new Map(),
    extraAssets: new Map(),
    hiddenAlbumIds: new Set(),
    leftEyeIds: new Set(),
    gaps: new Map(),
    withheldIds: new Set(),
  };

  const links = stereoLinks(input);
  const claimed = new Set(links.values());
  for (const [leftName, rightName] of links) pairLinkedAlbums(pairing, input, leftName, rightName);

  for (const [album, role] of Object.entries(input.roles)) {
    if (role === 'both') recordBothEyeAlbum(pairing, input, album);
    // An album marked as one eye and linked to nothing holds only halves. No album was ever named
    // as the other side, so no amount of scanning could turn one up: the gap is in the setup, and
    // that is as certain before a scan as after one.
    if (role === 'left' && !links.has(album)) markWholeAlbum(pairing, input, album, 'right');
    if (role === 'right' && !claimed.has(album)) markWholeAlbum(pairing, input, album, 'left');
  }

  return pairing;
}

/** The pairings that still describe two split albums: a left one linked to a right one. */
function stereoLinks(input: StereoPairingInput): Map<string, string> {
  return new Map(
    Object.entries(input.partners).filter(
      ([left, right]) => input.roles[left] === 'left' && input.roles[right] === 'right',
    ),
  );
}

/**
 * An album holding both eyes of every shot. The in-album detector has already found every pair it
 * can, so a frame it left ungrouped has no near-identical partner in the album — once the album has
 * been scanned to the end, which is the only state that makes that a fact rather than a guess.
 *
 * Which eye is missing cannot be said here, and is not pretended: both eyes came out of one album,
 * so a lone frame could be either side.
 */
function recordBothEyeAlbum(
  pairing: StereoPairing,
  input: StereoPairingInput,
  album: string,
): void {
  const albumId = input.albumIdByName.get(album);
  if (!albumId) return;
  const settled = input.fullyScanned.has(albumId);
  // Found and searched are the same album here, which is what tells the card to offer one place to
  // go and look rather than the same place twice.
  const here: StereoAlbumRef = { name: album, id: albumId };
  for (const asset of input.assetsByAlbum.get(albumId) ?? []) {
    if (input.groupedIds.has(asset.id)) continue;
    if (settled)
      pairing.gaps.set(asset.id, { missing: 'unknown', foundIn: here, expectedIn: here });
    else pairing.withheldIds.add(asset.id);
  }
}

/** Matches one shoot's two albums, and records what selection should do with each side. */
function pairLinkedAlbums(
  pairing: StereoPairing,
  input: StereoPairingInput,
  leftName: string,
  rightName: string,
): void {
  const leftId = input.albumIdByName.get(leftName);
  const rightId = input.albumIdByName.get(rightName);
  if (!leftId) return;
  // The album named as the other half is not in the catalogue at all: every left frame is a half
  // waiting on an album that is not there, and no scan is going to change that.
  if (!rightId) {
    markWholeAlbum(pairing, input, leftName, 'right');
    return;
  }

  // The right album never stands on its own — its frames reach review through the left album,
  // whole as pairs and, when they did not pair, as halves that name what they are waiting for.
  pairing.hiddenAlbumIds.add(rightId);

  const leftAssets = input.assetsByAlbum.get(leftId) ?? [];
  const rightAssets = input.assetsByAlbum.get(rightId) ?? [];
  const pairs = pairEyes(
    toEyeFrames(leftAssets),
    toEyeFrames(rightAssets),
    input.signatures,
    input.options,
  );

  const rightById = new Map(rightAssets.map((asset) => [asset.id, asset]));
  const paired = new Set<string>();
  for (const pair of pairs) {
    const rightAsset = rightById.get(pair.rightId);
    if (!rightAsset) continue;
    pushInto(pairing.groups, leftId, {
      type: 'stereo',
      sourceAlbumId: leftId,
      // Left first: the order is what the hydrator falls back on, and it is right by construction.
      memberIds: [pair.leftId, pair.rightId],
    });
    pushInto(pairing.extraAssets, leftId, rightAsset);
    pairing.leftEyeIds.add(pair.leftId);
    paired.add(pair.leftId);
    paired.add(pair.rightId);
  }

  const settled = input.fullyScanned.has(leftId) && input.fullyScanned.has(rightId);
  const albums: SplitAlbums = {
    left: { name: leftName, id: leftId },
    right: { name: rightName, id: rightId },
    settled,
  };
  recordLeftovers(pairing, albums, leftAssets, rightAssets, paired);
}

/** The two albums of one shoot, as the leftover pass needs to name them. */
interface SplitAlbums {
  left: StereoAlbumRef;
  right: StereoAlbumRef;
  /** Both albums are scanned to the end, so a frame that did not pair here never will. */
  settled: boolean;
}

/**
 * Records what the match left over, on both sides: a named gap once both albums are scanned out, and
 * otherwise nothing at all.
 *
 * Early in a backfill the leftovers are most of the shoot — the two albums are read a prefix at a
 * time and rarely reach the same depth at once — so calling those halves "missing" would be calling
 * the scan's own progress a fault in the library.
 */
function recordLeftovers(
  pairing: StereoPairing,
  albums: SplitAlbums,
  leftAssets: readonly PhotoAsset[],
  rightAssets: readonly PhotoAsset[],
  paired: ReadonlySet<string>,
): void {
  for (const asset of leftAssets) {
    if (paired.has(asset.id)) continue;
    if (!albums.settled) {
      pairing.withheldIds.add(asset.id);
      continue;
    }
    pairing.gaps.set(asset.id, {
      missing: 'right',
      foundIn: albums.left,
      expectedIn: albums.right,
    });
  }
  for (const asset of rightAssets) {
    if (paired.has(asset.id) || !albums.settled) continue; // the right album is hidden either way
    pairing.gaps.set(asset.id, {
      missing: 'left',
      foundIn: albums.right,
      expectedIn: albums.left,
    });
    // The right album is off the deck, so a right-eye half reaches review through the left album.
    pushInto(pairing.extraAssets, albums.left.id, asset);
  }
}

/**
 * Marks every frame of an album as a half missing `missing` — for an album with nobody to pair
 * against. `expectedIn` names the album that was supposed to hold the other eye, when one was named
 * at all; there is nothing to open when nothing was.
 */
function markWholeAlbum(
  pairing: StereoPairing,
  input: StereoPairingInput,
  album: string,
  missing: StereoGap['missing'],
  expectedIn: StereoAlbumRef | null = null,
): void {
  const albumId = input.albumIdByName.get(album);
  if (!albumId) return;
  const foundIn: StereoAlbumRef = { name: album, id: albumId };
  for (const asset of input.assetsByAlbum.get(albumId) ?? []) {
    pairing.gaps.set(asset.id, { missing, foundIn, expectedIn });
  }
}

function toEyeFrames(assets: readonly PhotoAsset[]): EyeFrame[] {
  return assets.map((asset) => ({ id: asset.id, taken: asset.payload?.captureDate ?? '' }));
}

function pushInto<T>(map: Map<string, T[]>, key: string, value: T): void {
  map.set(key, [...(map.get(key) ?? []), value]);
}
