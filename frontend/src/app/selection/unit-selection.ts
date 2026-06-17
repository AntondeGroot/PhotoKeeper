// Group-aware on-device selection (Track B, Slice 4).
//
// Pure over album assets + detected groups — no network, no storage — so it's cheap to re-run and
// easy to test. It samples the review queue over **units**, where a unit is either a single photo or
// a detected group (e.g. a burst), so a burst reaches the queue as one `BurstCard` instead of its
// frames scattering across the sample. Mirrors the old server-side album-weighted sampling
// (vacation albums over-represented, capped per album) but operates on whole units.

import { PhotoAsset } from '../lightroom.service';
import { DetectedGroup } from '../storage/photokeeper-db';
import { Burst, BurstPhoto, Photo, ReviewItem } from '../photo';

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
    const members = group.memberIds
      .map((id) => byId.get(id))
      .filter((a): a is PhotoAsset => a !== undefined);
    // A group whose members no longer all exist (≥2 needed) is no longer a group; its surviving
    // members fall through to singles below.
    if (group.type !== 'burst' || members.length < 2) continue;
    members.forEach((m) => grouped.add(m.id));
    units.push(toBurst(group, members, album.albumName));
  }

  for (const asset of album.assets) {
    if (asset.subtype === 'image' && !grouped.has(asset.id)) {
      units.push(toPhoto(asset, album.albumName));
    }
  }
  return units;
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
  return unit.kind === 'burst' ? unit.photos.map((p) => p.id) : [unit.id];
}

function toPhoto(asset: PhotoAsset, albumName: string | null): Photo {
  return {
    id: asset.id,
    name: baseName(asset),
    album: albumName,
    taken: asset.payload?.captureDate ?? '',
    status: 'backlog',
    kind: 'photo',
    starred: false,
    keepsake: false,
  };
}

function toBurst(group: DetectedGroup, members: PhotoAsset[], albumName: string | null): Burst {
  const photos: BurstPhoto[] = members.map((m) => ({ id: m.id, name: baseName(m) }));
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

function baseName(asset: PhotoAsset): string {
  return (asset.payload?.importSource?.fileName ?? asset.id).replace(/\.[^.]+$/, '');
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
