// Group-aware on-device selection (Track B, Slice 4).
//
// Pure over album assets + detected groups — no network, no storage — so it's cheap to re-run and
// easy to test. It samples the review queue over **units**, where a unit is either a single photo or
// a detected group (e.g. a burst), so a burst reaches the queue as one `BurstCard` instead of its
// frames scattering across the sample. Mirrors the old server-side album-weighted sampling
// (vacation albums over-represented, capped per album) but operates on whole units.

import { PhotoAsset } from '../../lightroom-types';
import { DetectedGroup } from '../../detection/detectors/detection-types';
import { Burst, BurstPhoto, Pano, PanoFrame, Photo, ReviewItem, splitFileName } from '../../photo';

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

/** Hydrates a detected group into its review unit, or null for kinds without a card yet (stereo). */
function hydrateGroup(
  group: DetectedGroup,
  members: PhotoAsset[],
  albumName: string | null,
): ReviewItem | null {
  if (group.type === 'burst') return toBurst(group, members, albumName);
  if (group.type === 'pano') return toPano(group, members, albumName);
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

function unitAssetIds(unit: ReviewItem): string[] {
  if (unit.kind === 'burst') return unit.photos.map((p) => p.id);
  if (unit.kind === 'pano') return unit.frames.map((f) => f.id);
  return [unit.id];
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
