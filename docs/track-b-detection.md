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

## Detection runs BEFORE selection (not on today's queue)

Detection must run over the **full album population, upstream of selection**. The sampler then picks
**units** — a detected burst enters the queue as *one* `BurstCard`, a single as one photo — so by the
time anything reaches today's queue it is already classified.

Do **not** hash today's already-sampled queue: that queue is ~20 photos sampled across albums, so a
burst's frames almost never all land in the sample. Hashing it would "detect" a burst only in the
rare case the sampler happened to pull every frame — logically backwards. Reusing an
already-warmed 2048 blob to avoid a thumbnail fetch is a valid optimization *inside* the scan, but it
is not the trigger for the scan.

Corrected pipeline order:

1. **Background album scan** (per album, gated by `albumManifest`): fetch the album's full asset
   metadata.
2. **Hash** new/changed assets from a small rendition (256–512px) → `assetHash`.
3. **Cluster** → store `groups`.
4. **Selection samples over `units = singles + groups`**, so the queue receives already-formed groups.

## Selection is group-aware and runs ON-DEVICE (decided)

Group-aware selection lives **on-device**, not on the server. The device already holds the detected
`groups` (in IndexedDB) and the tokens, so it samples over `units = singles + groups` locally. This
supersedes the current server-side flat `api/feed` sampling (see the photo-selection memory) for the
grouped path. The backend's role shrinks to serving album asset lists + renditions; the unit
sampling moves client-side.

(Note the still-open fork above is only about the *scan's scheduling trigger* — device-when-idle vs
Pi-nightly. Where *selection* runs is now settled: on-device.)

## Re-sequenced slices

- **Slice 1 — detection core** ✅ done: `assetHash` store, pure `dhash` + `hammingDistance`
  (`detection/phash.ts`), pure `clusterBursts` (`detection/burst.ts`), thin canvas `hashImageBlob`.
- **Slice 2 — album-asset listing + manifest change-gate** ✅ done: backend `GET
  /api/albums/{id}/assets` (full `links.next` pagination) + `LightroomService.getAllAlbumAssets`
  frontend method; `albumManifest` store with `id+updated` fingerprints, hash gate, and
  added/removed/changed `diffManifest` (`storage/album-manifest-store.ts`).
- **Slice 3 — background scan** ✅ done (burst path): `DetectionScanService.scanAlbum` —
  manifest-gated, hashes only added/edited assets (reusing a warmed 2048 preview when present, else
  fetching the 640 rendition via injectable `ImageHasher`), re-clusters bursts over the whole album,
  and stores them in the new `groups` store (`GroupStore`). Pano/stereo group types await their
  classifiers (only `clusterBursts` exists today); thresholds are provisional pending the corpus.
- **Slice 4 — group-aware on-device selection** (in progress):
  - Pure core ✅ done — `selectUnits` (`selection/unit-selection.ts`) samples album-weighted over
    `units = singles + groups`, hydrating burst groups into `Burst` review items (pano/stereo ignored
    until their hydrators exist).
  - Asset-metadata persistence ✅ done — the scan writes each asset's `{albumId, name, taken}` to the
    `assetMeta` store (`storage/asset-meta-store.ts`) and drops it on removal, so selection reads from
    IndexedDB instead of re-fetching album lists on load (avoids the cold-load fetch cost).
  - Catalog scan driver ✅ done — `CatalogScanService.scanAllAlbums`
    (`detection/catalog-scan.service.ts`) runs `scanAlbum` across every album, best-effort
    (one failing album doesn't stall the rest), with a per-pass hash budget so a first-time backfill
    spreads over runs and stays gentle on Adobe's RPS limit (atomic per album → safe to resume).
  - Selection assembler ✅ done — `DailyUnitsService.buildUnits`
    (`selection/daily-units.service.ts`) reads `assetMeta` + `groups` from IndexedDB, buckets them by
    album (names from the cheap `getAlbums`, vacation flags passed in), and runs `selectUnits` — a
    pure on-device read, no album-list re-fetch.
  - `app.ts` wiring ✅ done — `loadPhotos`/`precomputeTomorrow` now build the queue via
    `DailyUnitsService.buildUnits` (server `getFeed` only as the cold-start fallback before the first
    scan); the `dailyFeed` store holds `ReviewItem[]`; the verdict overlay is unit-aware; and an
    opportunistic `CatalogScanService.scanAllAlbums()` runs in the background after load to populate
    detection storage for next session. **Slice 4 complete** for the burst path.

The earlier "hash today's queue" idea is dropped.

## Benchmark corpus (future, for tuning Slice 3)

The Slice-1 unit tests use synthetic hashes — they prove the *logic*, not that the *thresholds*
(`windowMs`, `maxHamming`, `minSize`, and the pano/stereo equivalents) match real bursts/panos. Plan
a labeled corpus of **real photos exported small** (≈256–512px, the hash source size), organized by
expected grouping (burst / pano / stereo / A-vs-B / single), committed under `fixtures/`. A spec
hashes them through real `hashImageBlob` and asserts the detected groups match the labels, tracking
precision/recall so threshold or hash changes don't silently regress. Add this when building Slice 3,
where real thresholds start to matter.