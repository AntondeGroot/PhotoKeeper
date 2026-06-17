# Track B — Grouping Detection (bursts / pano / stereo / A-vs-B)

Background-precompute work splits into two independent tracks:

- **Track A — feed/preview warming**: cheap, pure I/O, no algorithm. Pre-sample *tomorrow's*
  daily selection and warm its 2048px previews to the durable `PreviewStore` so the next session
  opens instantly. (Drafted separately; ship as its own commit.)
- **Track B — grouping detection** (this doc): a standing index over the library that detects
  bursts, panoramas, stereo sets, and A-vs-B near-duplicates, caches the results, and only
  recomputes what actually changed.

Keep them separate — A is one day of warming, B is a standing index.

## What it produces

A set of detected `ReviewItem`s (`burst | pano | stereo`) plus the leftover singles (`photo`),
replacing the mock groups currently feeding `BurstCard` / `PanoCard` / `StereoCard`. The review
feed becomes *real detected groups + ungrouped photos* instead of a flat photo list.

Output shapes are the existing `ReviewItem` union (see `frontend/src/app/photo.ts`):
`Burst.photos[]`, `Pano.frames[]`, `Stereo.left + baselines[]`. Detection hydrates these — the
cards already render them.

## Data model — three new IndexedDB stores

Alongside the existing `verdicts` / `dailyFeed` / `albumTags` stores in `PhotoKeeperDb`:

| Store | Key | Value | Purpose |
|---|---|---|---|
| `assetHash` | `assetId` | `{ phash: string /* 64-bit hex */, taken: string, camera?: string }` | Perceptual hash + the cheap metadata used for grouping. Tens of bytes/asset. Pixels are discarded after hashing. |
| `albumManifest` | `albumId` | `{ hash: string, fingerprints: {id, updated}[], computedAt: number }` | Change-detection gate (see Stage 0). |
| `groups` | `groupId` | `{ type, sourceAlbumId, memberIds[], extras }` | Detected groups, ready to hydrate into the `ReviewItem` union. |

## Pipeline (per album)

### Stage 0 — change gate
Fetch the album-assets list (metadata only, `?embed=asset`). Build a manifest: sorted
`id + updated` fingerprints, hashed. Compare to the stored `albumManifest`:

- **Hash matches** → skip the whole album. Nothing changed.
- **Hash differs** → diff the fingerprint lists → the set of added / removed / changed asset ids.
  Only those proceed. Removed ids: drop their `assetHash` and any group they belonged to.

Lightroom assets carry `created` / `updated` timestamps (and revision ids) — fingerprint on
`id + updated` rather than hashing filenames; it catches edits/replacements, not just adds/removes.
Confirm the field is present in the album-assets payload.

### Stage 1 — metadata grouping (Tier 1, cheap, no pixels)
Over the changed assets **plus their temporal neighbors** (adding one frame can merge/split a
burst with the shots on either side in time), cluster by **capture-time proximity + same
camera/lens**. Yields **burst** candidates with no download.

### Stage 2 — pixel hashing (Tier 2, small images)
For any asset in a candidate cluster without a cached `assetHash`:

- If its 2048 preview is already warmed (today's feed) → **downscale that blob in a canvas, hash,
  store. Zero extra network.**
- Otherwise → fetch the **smallest rendition** (fixed **256–512px, grayscale**) purely to hash,
  then **discard the pixels** — store only the 64-bit `phash`.

Standardize every hash through the same fixed-size/grayscale pipeline so Hamming thresholds are
comparable library-wide. Going too small (e.g. 64px) loses the high-frequency detail that
separates near-dupes and over-merges distinct shots; 256–512px is the safe floor and covers
pano/stereo (which want slightly more detail than burst/A-vs-B) since we only *detect candidates*,
never stitch.

### Stage 3 — classification (pure, in-memory Hamming math)
Within each time cluster, compare hashes (Hamming distance on 64 bits):

- **Burst** → many near-duplicates in a tight time window → `Burst.photos[]`, flag likely blur / best-of.
- **A-vs-B** → a pair/small set of near-dupes → a burst surfaced as the duel UI.
- **Pano** → sequential, consistent exposure, partial edge-overlap (low Hamming on adjacent
  edge-bands, not whole-frame) → `Pano.frames[]`.
- **Stereo** → near-identical frames with small horizontal parallax → `Stereo.left + baselines[]`.

Write results to `groups`. Re-running detection with no album changes is pure Hamming math over the
cached hashes — no pixels, no network.

## Why perceptual hashing on a small image is correct (not a shortcut)

Every perceptual hash downscales to tiny as its first step and throws the rest away:

- **dHash**: grayscale → resize 9×8 → compare adjacent pixels → 64-bit hash.
- **pHash**: resize 32×32 → DCT → keep 8×8 low-frequency block → 64-bit hash.

A 2048px or a 256px source collapses to the same ~64 bits. The big image just means decoding
pixels you immediately discard. The compare is trivially cheap regardless; the cost is all in
fetch + decode + downscale, so a smaller source slashes all three. **Store only the 64-bit hash,
never the thumbnail** — the `assetId → hash` index stays ~8 bytes/photo and later re-runs are pure
in-memory math.

## Key properties

- **Incremental**: edit one photo → only that album's gate misses, and only the touched assets
  (+ neighbors) recompute; everything else is a hash comparison.
- **Cheap to re-run**: once hashed, detection is in-memory — re-tune thresholds without
  re-downloading.
- **Tiny storage**: hash-only index, no thumbnails retained.
- **Composes with Track A**: warmed 2048 previews get hashed in-canvas with no extra fetch.

## Open fork — where the nightly job runs

The pipeline is **pure and host-agnostic**; only the *trigger* differs.

- **On-device when idle/charging** (Capacitor BackgroundTask / iOS BGProcessingTask): no token
  problem (device already has tokens), but background scheduling on phones is unreliable/time-boxed.
- **Pi nightly**: always-on, reliable — but reopens server-side token storage, which we deliberately
  deferred when we made the Pi stateless (device stores tokens).

Decision deferred. Build and test entirely on-device first; choose scheduling later without rework.

## Suggested first slice

`assetHash` + `albumManifest` stores → Stage 0 gate + Stage 1 burst clustering + Stage 2 hashing
**for already-warmed assets only** → light up `BurstCard` with real bursts from today's feed. No new
rendition size, no library-wide crawl yet. Proves the gate, the cache, and the burst path
end-to-end before adding pano/stereo and the small-thumbnail crawl.