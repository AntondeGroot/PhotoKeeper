// Group-aware on-device selection (Track B, Slice 4).
//
// Pure over album assets + detected groups — no network, no storage — so it's cheap to re-run and
// easy to test. It samples the review queue over **units**, where a unit is either a single photo or
// a detected group (e.g. a burst), so a burst reaches the queue as one `BurstCard` instead of its
// frames scattering across the sample. Mirrors the old server-side album-weighted sampling
// (vacation albums over-represented, capped per album) but operates on whole units.

import { PhotoAsset } from '../../lightroom-types';
import { DetectedGroup } from '../../detection/detectors/detection-types';
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
    // members fall through to singles below. Stereo has no detector/card yet, so it's skipped too.
    if (members.length < 2) continue;
    const unit = hydrateGroup(group, members, album.albumName);
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
  albumName: string | null,
): ReviewItem | null {
  if (group.type === 'burst') return toBurst(group, members, albumName);
  if (group.type === 'pano') return toPano(group, members, albumName);
  if (group.type === 'stereo') return toStereo(group, members, albumName);
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

/** Frames within this distance of each other are treated as one camera position (GPS jitter slack). */
const SAME_POSITION_M = 2;

/**
 * Hydrates a stereo set into its review unit. The detector hands over a flat cluster of near-identical
 * frames; here we split it into the shared reference position (`left`) plus one `baseline` per other
 * camera position, labelled by its GPS displacement from the reference. The first member's position is
 * the reference (capture order — the base is shot first), and baselines sort nearest-first. When GPS is
 * missing or every frame sits at one spot there's no measurable parallax, so we degrade to the first
 * frame as the left eye and the remainder as a single unlabelled baseline (the viewer still gets a pair).
 */
function toStereo(group: DetectedGroup, members: PhotoAsset[], albumName: string | null): Stereo {
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

  const positions = clusterPositions(members);
  if (positions.length < 2 || !positions[0].centroid) {
    const [first, ...rest] = members;
    return {
      ...base,
      left: [toStereoFrame(first)],
      baselines: [
        {
          key: 'b0',
          label: 'pair',
          hint: frameCount(rest.length),
          frames: rest.map(toStereoFrame),
        },
      ],
    };
  }

  const ref = positions[0].centroid;
  const baselines = positions
    .slice(1)
    .map((p) => ({
      p,
      meters: haversineMeters(ref.lat, ref.lng, p.centroid!.lat, p.centroid!.lng),
    }))
    .sort((a, b) => a.meters - b.meters)
    .map(
      ({ p, meters }, i): StereoBaseline => ({
        key: `b${i}`,
        label: `${Math.round(meters)} m`,
        hint: frameCount(p.frames.length),
        frames: p.frames.map(toStereoFrame),
      }),
    );
  return { ...base, left: positions[0].frames.map(toStereoFrame), baselines };
}

interface Position {
  frames: PhotoAsset[];
  centroid: { lat: number; lng: number } | null; // null when any frame in the set lacks GPS
}

/**
 * Groups a stereo set's frames into camera positions by GPS proximity (single-linkage, {@link
 * SAME_POSITION_M}). Components keep input order, so the first member's position is first. If any frame
 * lacks GPS the whole set collapses to one centroid-less position, forcing the no-parallax fall-back.
 */
function clusterPositions(members: PhotoAsset[]): Position[] {
  const pts = members.map(gpsOf);
  if (pts.some((p) => p === null)) return [{ frames: members, centroid: null }];

  const parent = members.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const a = pts[i]!;
      const b = pts[j]!;
      if (haversineMeters(a.lat, a.lng, b.lat, b.lng) <= SAME_POSITION_M) {
        parent[Math.max(find(i), find(j))] = Math.min(find(i), find(j));
      }
    }
  }

  const byRoot = new Map<number, PhotoAsset[]>();
  for (let i = 0; i < members.length; i++) {
    const root = find(i);
    (byRoot.get(root) ?? byRoot.set(root, []).get(root)!).push(members[i]);
  }
  return [...byRoot.values()].map((frames) => ({ frames, centroid: centroidOf(frames) }));
}

function centroidOf(frames: PhotoAsset[]): { lat: number; lng: number } {
  const pts = frames.map((f) => gpsOf(f)!);
  const lat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const lng = pts.reduce((s, p) => s + p.lng, 0) / pts.length;
  return { lat, lng };
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
