// Group-aware on-device selection (Track B, Slice 4).
//
// Pure over album assets + detected groups — no network, no storage — so it's cheap to re-run and
// easy to test. It samples the review queue over **units**, where a unit is either a single photo or
// a detected group (e.g. a burst), so a burst reaches the queue as one `BurstCard` instead of its
// frames scattering across the sample. Mirrors the old server-side album-weighted sampling
// (vacation albums over-represented, capped per album) but operates on whole units.

import { PhotoAsset } from '../../lightroom-types';
import { DetectedGroup } from '../../detection/detectors/detection-types';
import { cameraSerial } from '../../camera-metadata';
import { haversineMeters } from '../../detection/detectors/stereo';
import {
  Burst,
  BurstPhoto,
  Pano,
  PanoFrame,
  Photo,
  ReviewItem,
  Stereo,
  StereoBaseline,
  StereoFrame,
  splitFileName,
  unitAssetIds,
} from '../../photo';

/** One album's raw material: its assets, its detected groups, and whether it's a vacation album. */
export interface AlbumUnits {
  albumId: string;
  albumName: string | null;
  isVacation: boolean;
  assets: readonly PhotoAsset[];
  groups: readonly DetectedGroup[];
  /** Camera serial designated as the left eye for this stereo album's twin-DSLR rig (see PreferencesService). */
  stereoLeftSerial?: string;
}

/** A vacation album is this many times more likely to be drawn than a normal album. */
const VACATION_WEIGHT = 3;
/** Soft cap per album in the spread pass, so the queue fans across albums before topping up. */
const UNITS_PER_ALBUM = 4;

/**
 * Samples up to `limit` review units across the albums. Two passes: first **spread** — at most
 * {@link UNITS_PER_ALBUM} per album, in weighted order, so the queue fans across albums — then
 * **fill** from the held-back units until `limit` is reached (so a goal is met even when only a few
 * albums have photos). `rng` returns a float in [0, 1), injectable for deterministic tests. Each
 * asset appears at most once (a shared asset, or a burst member, is never also drawn as a single).
 */
export function selectUnits(
  albums: readonly AlbumUnits[],
  limit: number,
  rng: () => number = Math.random,
): ReviewItem[] {
  const unitsByAlbum = new Map(albums.map((a) => [a.albumId, buildAlbumUnits(a)]));
  const consumed = new Set<string>();
  const picked: ReviewItem[] = [];
  const leftovers: ReviewItem[] = [];

  const take = (unit: ReviewItem): boolean => {
    const ids = unitAssetIds(unit);
    if (ids.some((id) => consumed.has(id))) return false; // asset already used elsewhere
    ids.forEach((id) => consumed.add(id));
    picked.push(unit);
    return true;
  };

  // Pass 1 — spread: up to UNITS_PER_ALBUM new units per album; the rest are held back.
  for (const album of weightedAlbumOrder(albums, rng)) {
    if (picked.length >= limit) break;
    let taken = 0;
    for (const unit of shuffle(unitsByAlbum.get(album.albumId) ?? [], rng)) {
      if (picked.length >= limit) break;
      if (taken >= UNITS_PER_ALBUM) leftovers.push(unit);
      else if (take(unit)) taken++;
    }
  }

  // Pass 2 — fill: top up from the held-back units until the goal is reached.
  for (const unit of shuffle(leftovers, rng)) {
    if (picked.length >= limit) break;
    take(unit);
  }

  return shuffle(picked, rng).slice(0, limit);
}

/** Detected groups → group units (hydrated) + every ungrouped image → a single photo unit. */
function buildAlbumUnits(album: AlbumUnits): ReviewItem[] {
  const byId = new Map(album.assets.map((a) => [a.id, a]));
  const grouped = new Set<string>();
  const units: ReviewItem[] = [];

  for (const group of album.groups) {
    // Dedupe member ids: a stored group should never list an asset twice, but if one slips through
    // (e.g. a pagination repeat at scan time) the duel would pit a frame against itself. `new Set`
    // keeps first-seen order. Also fixes already-stored groups with no re-scan.
    const members = [...new Set(group.memberIds)]
      .map((id) => byId.get(id))
      .filter((a): a is PhotoAsset => a !== undefined);
    // A group whose members no longer all exist (≥2 needed) is no longer a group; its surviving
    // members fall through to singles below.
    if (members.length < 2) continue;
    const unit = hydrateGroup(group, members, album);
    if (!unit) continue;
    members.forEach((m) => grouped.add(m.id));
    units.push(unit);
  }

  for (const asset of album.assets) {
    if (asset.subtype === 'image' && !grouped.has(asset.id)) {
      units.push(toPhoto(asset, album.albumName));
    }
  }
  return units;
}

/** Hydrates a detected group into its review unit, or null for kinds without a card yet. */
function hydrateGroup(
  group: DetectedGroup,
  members: PhotoAsset[],
  album: AlbumUnits,
): ReviewItem | null {
  if (group.type === 'burst') return toBurst(group, members, album.albumName);
  if (group.type === 'pano') return toPano(group, members, album.albumName);
  if (group.type === 'stereo')
    return toStereo(group, members, album.albumName, album.stereoLeftSerial);
  return null;
}

/** Album draw order: vacation albums over-represented, shuffled, then de-duplicated to first hit. */
function weightedAlbumOrder(albums: readonly AlbumUnits[], rng: () => number): AlbumUnits[] {
  const pool: AlbumUnits[] = [];
  for (const album of albums) {
    const weight = album.isVacation ? VACATION_WEIGHT : 1;
    for (let i = 0; i < weight; i++) pool.push(album);
  }
  const seen = new Set<string>();
  const order: AlbumUnits[] = [];
  for (const album of shuffle(pool, rng)) {
    if (!seen.has(album.albumId)) {
      seen.add(album.albumId);
      order.push(album);
    }
  }
  return order;
}

function toPhoto(asset: PhotoAsset, albumName: string | null): Photo {
  const { name, ext } = splitAsset(asset);
  return {
    id: asset.id,
    name,
    ext,
    album: albumName,
    taken: asset.payload?.captureDate ?? '',
    status: 'backlog',
    kind: 'photo',
    starred: false,
    keepsake: false,
  };
}

function toBurst(group: DetectedGroup, members: PhotoAsset[], albumName: string | null): Burst {
  const photos: BurstPhoto[] = members.map((m) => ({ id: m.id, ...splitAsset(m) }));
  const taken = members
    .map((m) => m.payload?.captureDate ?? '')
    .filter((t) => t)
    .sort((a, b) => a.localeCompare(b))[0];
  return {
    id: `burst:${group.sourceAlbumId}:${members[0].id}`,
    name: `Burst · ${members.length} frames`,
    album: albumName,
    taken: taken ?? '',
    status: 'backlog',
    kind: 'burst',
    photos,
  };
}

function toPano(group: DetectedGroup, members: PhotoAsset[], albumName: string | null): Pano {
  const frames: PanoFrame[] = members.map((m) => ({ id: m.id, ...splitAsset(m) }));
  const taken = members
    .map((m) => m.payload?.captureDate ?? '')
    .filter((t) => t)
    .sort((a, b) => a.localeCompare(b))[0];
  return {
    id: `pano:${group.sourceAlbumId}:${members[0].id}`,
    name: `Panorama · ${members.length} frames`,
    album: albumName,
    taken: taken ?? '',
    status: 'backlog',
    kind: 'pano',
    orientation: group.orientation ?? 'horizontal',
    frames,
  };
}

/**
 * Hydrates a stereo set into its review unit, dispatching on the signal the capture style leaves behind:
 *
 * - **Twin-DSLR rig** — two bodies fire at once, so the set carries ≥ 2 distinct camera serials. The
 *   frames split by body: the album's chosen left serial (else, deterministically, the lexicographically
 *   smaller) is the left eye; the other body is the single right baseline. No GPS, no distance.
 * - **Drone hyperstereo** — one body, GPS present. We measure each frame's displacement from the
 *   reference (first member) and bucket by rounded metres: bucket 0 is the shared `left`, the rest are
 *   baselines labelled by measured distance (`"3 m"`, `"10 m"`); a lone pair reports its own separation.
 * - **Single camera, no GPS** (cha-cha) — nothing to measure: first frame is the left eye, the rest one
 *   undetermined `"pair"` (or `"<1 m"` when GPS is present but too coarse to resolve a baseline).
 */
function toStereo(
  group: DetectedGroup,
  members: PhotoAsset[],
  albumName: string | null,
  leftSerial?: string,
): Stereo {
  const taken = members
    .map((m) => m.payload?.captureDate ?? '')
    .filter((t) => t)
    .sort((a, b) => a.localeCompare(b))[0];
  const base = {
    id: `stereo:${group.sourceAlbumId}:${members[0].id}`,
    name: `Stereo set · ${members.length} frames`,
    album: albumName,
    taken: taken ?? '',
    status: 'backlog' as const,
    kind: 'stereo' as const,
  };

  // Twin-rig: ≥ 2 distinct serials → split by body rather than by GPS/time.
  const serials = members.map(cameraSerial);
  if (new Set(serials.filter((s): s is string => !!s)).size >= 2) {
    return { ...base, ...twinRigEyes(members, serials, leftSerial) };
  }

  const located = members.map((m) => ({ m, gps: gpsOf(m) }));
  const ref = located[0].gps;
  if (!ref || located.some((e) => e.gps === null)) {
    return { ...base, ...undeterminedPair(members) }; // no GPS → can't measure a baseline
  }

  // Bucket every frame by its rounded displacement (metres) from the reference. Bucket 0 — the reference
  // spot, sub-metre away — is the shared left eye; the rest are baselines, labelled and sorted nearest-first.
  const byMeters = new Map<number, PhotoAsset[]>();
  for (const { m, gps } of located) {
    const meters = Math.round(haversineMeters(ref.lat, ref.lng, gps!.lat, gps!.lng));
    (byMeters.get(meters) ?? byMeters.set(meters, []).get(meters)!).push(m);
  }
  const baselines = [...byMeters.entries()]
    .filter(([meters]) => meters > 0)
    .sort(([a], [b]) => a - b)
    .map(
      ([meters, frames], i): StereoBaseline => ({
        key: `b${i}`,
        label: `${meters} m`,
        hint: frameCount(frames.length),
        frames: frames.map(toStereoFrame),
      }),
    );

  // Every frame within a metre of the reference: GPS is too coarse to resolve the baseline, so keep the
  // first frame as the left eye and the rest as one sub-metre pair (still flagged as a tight baseline).
  if (baselines.length === 0) return { ...base, ...undeterminedPair(members, '<1 m') };

  return { ...base, left: byMeters.get(0)!.map(toStereoFrame), baselines };
}

/**
 * Twin-DSLR split: the left body's frames are the left eye, the right body's the single right baseline.
 * `leftSerial` is the user's per-album choice; absent (or not present in the set) we pick the
 * lexicographically smaller serial so the default is stable across re-scans and a swap is well-defined.
 * Frames whose serial isn't the left one (the other body, or any without a serial) become the right eye.
 */
function twinRigEyes(
  members: PhotoAsset[],
  serials: (string | undefined)[],
  leftSerial?: string,
): Pick<Stereo, 'left' | 'baselines'> {
  const present = [...new Set(serials.filter((s): s is string => !!s))].sort((a, b) =>
    a.localeCompare(b),
  );
  const left = leftSerial && present.includes(leftSerial) ? leftSerial : present[0];
  const leftFrames = members.filter((_, i) => serials[i] === left);
  const rightFrames = members.filter((_, i) => serials[i] !== left);
  return {
    left: leftFrames.map(toStereoFrame),
    baselines: [
      {
        key: 'b0',
        label: 'pair',
        hint: frameCount(rightFrames.length),
        frames: rightFrames.map(toStereoFrame),
      },
    ],
  };
}

/** First frame as the left eye, the rest as a single baseline — when GPS can't resolve a distance. */
function undeterminedPair(
  members: PhotoAsset[],
  label = 'pair',
): Pick<Stereo, 'left' | 'baselines'> {
  const [first, ...rest] = members;
  return {
    left: [toStereoFrame(first)],
    baselines: [
      { key: 'b0', label, hint: frameCount(rest.length), frames: rest.map(toStereoFrame) },
    ],
  };
}

function gpsOf(asset: PhotoAsset): { lat: number; lng: number } | null {
  const loc = asset.payload?.location;
  return loc?.latitude !== undefined && loc.longitude !== undefined
    ? { lat: loc.latitude, lng: loc.longitude }
    : null;
}

function toStereoFrame(asset: PhotoAsset): StereoFrame {
  return { id: asset.id, ...splitAsset(asset) };
}

const frameCount = (n: number): string => `${n} frame${n === 1 ? '' : 's'}`;

/** The display name + original extension of an asset, from its import filename (falling back to id). */
function splitAsset(asset: PhotoAsset): { name: string; ext?: string } {
  return splitFileName(asset.payload?.importSource?.fileName ?? asset.id);
}

/** Fisher–Yates with an injected rng, on a copy (never mutates the input). */
function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
