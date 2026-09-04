# Track B — Grouping Detection (bursts / pano / stereo / A-vs-B)

Background-precompute work splits into two independent tracks:

- **Track A — feed/preview warming**: cheap, pure I/O, no algorithm. Pre-sample _tomorrow's_
  daily selection and warm its 2048px previews to the durable `PreviewStore` so the next session
  opens instantly. (Drafted separately; ship as its own commit.)
- **Track B — grouping detection** (this doc): a standing index over the library that detects
  bursts, panoramas, stereo sets, and A-vs-B near-duplicates, caches the results, and only
  recomputes what actually changed.

Keep them separate — A is one day of warming, B is a standing index.

## What it produces

A set of detected `ReviewItem`s (`burst | pano | stereo`) plus the leftover singles (`photo`),
replacing the mock groups currently feeding `BurstCard` / `PanoCard` / `StereoCard`. The review
feed becomes _real detected groups + ungrouped photos_ instead of a flat photo list.

Output shapes are the existing `ReviewItem` union (see `frontend/src/app/photo.ts`):
`Burst.photos[]`, `Pano.frames[]`, `Stereo.left + baselines[]`. Detection hydrates these — the
cards already render them.

## Data model — three new IndexedDB stores

Alongside the existing `verdicts` / `dailyFeed` / `albumTags` stores in `PhotoKeeperDb`:

| Store            | Key                  | Value                                                                 | Purpose                                                                                                                                                                                                                                     |
| ---------------- | -------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assetHash`      | `assetId`            | `{ phash: string /* 64-bit hex */, taken: string, camera?: string }`  | Perceptual hash + the cheap metadata used for grouping. Tens of bytes/asset. Pixels are discarded after hashing.                                                                                                                            |
| `albumManifest`  | `albumId`            | `{ hash: string, fingerprints: {id, updated}[], computedAt: number }` | Change-detection gate (see Stage 0).                                                                                                                                                                                                        |
| `groups`         | `groupId`            | `{ type, sourceAlbumId, memberIds[], extras }`                        | Detected groups, ready to hydrate into the `ReviewItem` union.                                                                                                                                                                              |
| `groupOverrides` | member-set signature | `{ memberIds[], dissolvedAt }`                                        | User "not a group" / "review separately" corrections. Selection drops matching groups (frames → singles); detection stays pure. Intentionally records no calibration signal — a dissolve can mean "I want both", not "detection was wrong". |

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
pano/stereo (which want slightly more detail than burst/A-vs-B) since we only _detect candidates_,
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

The pipeline is **pure and host-agnostic**; only the _trigger_ differs.

- **On-device when idle/charging** (Capacitor BackgroundTask / iOS BGProcessingTask): no token
  problem (device already has tokens), but background scheduling on phones is unreliable/time-boxed.
- **Pi nightly**: always-on, reliable — but reopens server-side token storage, which we deliberately
  deferred when we made the Pi stateless (device stores tokens).

Decision deferred. Build and test entirely on-device first; choose scheduling later without rework.

## Detection runs BEFORE selection (not on today's queue)

Detection must run over the **full album population, upstream of selection**. The sampler then picks
**units** — a detected burst enters the queue as _one_ `BurstCard`, a single as one photo — so by the
time anything reaches today's queue it is already classified.

Do **not** hash today's already-sampled queue: that queue is ~20 photos sampled across albums, so a
burst's frames almost never all land in the sample. Hashing it would "detect" a burst only in the
rare case the sampler happened to pull every frame — logically backwards. Reusing an
already-warmed 2048 blob to avoid a thumbnail fetch is a valid optimization _inside_ the scan, but it
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

(Note the still-open fork above is only about the _scan's scheduling trigger_ — device-when-idle vs
Pi-nightly. Where _selection_ runs is now settled: on-device.)

## Re-sequenced slices

- **Slice 1 — detection core** ✅ done: `assetHash` store, pure `dhash` + `hammingDistance`
  (`detection/phash.ts`), pure `clusterBursts` (`detection/burst.ts`), thin canvas `hashImageBlob`.
- **Slice 2 — album-asset listing + manifest change-gate** ✅ done: backend `GET
/api/albums/{id}/assets` (full `links.next` pagination) + `LightroomService.getAllAlbumAssets`
  frontend method; `albumManifest` store with `id+updated` fingerprints, hash gate, and
  added/removed/changed `diffManifest` (`storage/album-manifest-store.ts`).
- **Slice 3 — background scan** ✅ done (burst path): `DetectionScanService.scanAlbum` —
  manifest-gated, then the tiered pipeline: Stage 1 clusters by **timestamp + camera only (no
  pixels)** to find burst candidates, Stage 2 hashes **only those candidate members** lacking a
  cached hash (reusing a warmed 2048 preview, else fetching one 640 rendition via `ImageHasher`),
  Stage 3 re-clusters with the hashes so the Hamming check confirms real bursts. Lone photos are
  never fetched or hashed. Groups land in the `groups` store (`GroupStore`). Pano/stereo group types
  await their classifiers (only `clusterBursts` exists today). Thresholds (`windowMs`, `maxHamming`,
  `minSize`) are now user-tunable and persisted via `DetectionSettingsService` (the scan reads them
  each run); the defaults are provisional pending the corpus. Note a wider `windowMs` enlarges Stage-1
  candidate runs, so it trades efficiency (more hashing during active shooting) for catching slower
  re-shoots.
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

## Slice 6 — split-album stereo (a left album and a right album)

Stereo today is one album holding both eyes: `clusterStereo` finds near-identical frames _inside_ an
album, and `hydrateStereo` splits the set into `left` + `baselines` — by camera serial for a twin-DSLR
rig, by GPS displacement for drone hyperstereo, by order for cha-cha. That covers every rig that
writes its two eyes into the same place.

It does not cover the other common workflow: **the eyes are imported into two albums**, one per body
(or one per pass). There, an album is not "a stereo album" — it is _half_ of one. So an album carries
a **role** rather than a flag:

- `both` — the album holds both eyes; pairing happens within it (today's behaviour).
- `left` / `right` — the album holds one eye of every shot; its partner is another album.

### Why in-album detection cannot be reused

An all-left album contains no near-identical frames at all — every frame is a different scene, so
`clusterStereo` returns nothing, and single-linkage clustering is the wrong shape of algorithm
regardless. Pairing across albums is a **bipartite match**, left frame → right frame, over signals we
already cache:

1. **The pictures carry the match — but not their hashes.** Two eyes of one shot are the same
   photograph seen from a step aside, and that is the only thing about them guaranteed to be true.
   It is _not_ what a dHash measures. A dHash compares each cell with its right neighbour, so moving
   the framing walks content across cell boundaries and flips bits wholesale. Measured on a real
   pair: sliding one eye sideways changed its hash distance from 8 to 5 to 14 — 9 bits of the 16 the
   tolerance allowed, spent on where the photographers had been standing.

   So the match is decided on the **aligned signature distance**: the two frames' 64² grayscale
   signatures, reduced to 32² and slid over one another horizontally (±6 columns), scored by the mean
   absolute difference at the best offset. Measured on two real hand-held split shoots:

   |                    | true pairs    | another moment, same scene | a different scene |
   | ------------------ | ------------- | -------------------------- | ----------------- |
   | luma Hamming (old) | 6, 9          | 17                         | 29                |
   | aligned signature  | **6.2, 15.9** | **34.3**                   | **52.5**          |

   The tolerance is 25, in the middle of that gap. Widening the _hash_ tolerance instead would have
   admitted every near-miss along with the real pairs; taking the framing out of the measurement
   separates them by more than twice.

   Two passes, because the aligned distance is far too expensive for every combination — but both
   passes are **the same measurement**, one coarse (8², slide ±2) and one careful (32², slide ±6).
   The closest survivor is claimed first, each frame at most once. A frame with no cached signature
   is not a candidate at all — it has not been scanned yet, and selection withholds it rather than
   guessing.

   The first pass was a _hash_ to begin with, and that was the same mistake one level down: a hash
   distance is mostly framing, so however generous the threshold (28 was tried), it still threw real
   pairs away — and threw them away silently, before anything could measure them properly. The lab
   panel caught it, because it computes its "nearest" without the pre-filter and so could report a
   pair as within tolerance, unclaimed, and yet unpaired. **A cheap version of the right measurement
   can be made as generous as you like; a cheap version of the wrong one cannot be made safe.**

   **Horizontal only, and 32²**, both measured rather than assumed. Allowing a vertical search as
   well pulled a _wrong_ answer from 38 down to 12 — below a true pair — because freedom given to the
   search is freedom given to a coincidence; two people photographing one moment differ mainly in
   where they stand along a line. And 32² separates almost as well as the full 64² (a gap of 18
   against 20) for a sixteenth of the arithmetic, which matters when every left frame is compared
   against every right one.

2. **The clocks only break ties.** Two bodies need not be synchronised, one may have been powered
   off and come back with its clock hours out, and the filenames are two independent counters.
   Nothing may depend on any of that. `estimateClockOffset` still votes the offset the true pairs
   share, and it separates two right frames that look _equally_ like one left frame — the same scene
   shot twice. Where the clocks agree about nothing, there is simply no tie-break.

   It was the other way round first: vote an offset, then match nearest-in-time within a second of
   it, with the hash as an optional veto. That failed exactly where it was needed — pairs obvious to
   the eye went unmatched because two cameras disagreed about what time it was — and it was
   dangerous where it worked, since a pair of unrelated photographs five minutes apart satisfies a
   five-minute offset as well as a real pair does.

3. **The eyes have to be hashed for any of this to work**, and for a long time they were not: the
   scan treated only a _both_-eyes album as a stereo album, so left/right albums fell to the burst
   time-cluster gate — and an all-left album forms no time clusters at all, every frame in it being
   a different scene. Almost nothing in one was ever hashed, which left the matcher with no picture
   to compare and nothing to go on but the clocks. Every stereo album, whichever eye it holds, now
   has all of its images hashed. A left/right album also gets **no groups of its own**: within one
   album two near-identical frames are two different stereographs, and grouping them asked which of
   two photographs was the better one.

4. **A frame with no partner — on either side — is never offered as a photograph.** It is half of
   one, and judging a half keeps it out of every later selection, so the shot could never be shown
   whole afterwards.

   What happens to it instead turns on one question: **is the other eye missing, or merely not
   looked for yet?** The albums are scanned a prefix at a time and rarely reach the same depth at
   once, so through most of a backfill "no partner" means nothing more than "the right album has not
   been read this far". The scan itself answers it — an album's manifest carries its population and
   its cursor, and `isFullyScanned` is the two compared.

   - **Both albums scanned to the end** (or no partner album named at all, which no amount of
     scanning would change) — the frame becomes an **incomplete pair**: a stereo card showing the eye
     that exists, an empty slot where the other should have been, and which album was searched.

     It offers three answers, and the third is the one that took longest to see was necessary.
     **Skip** decides nothing, because the pair may yet be shown whole. But a shot whose other eye
     does not exist — one body misfired, or the frame was never imported — can never be completed,
     and skipping it forever is not an answer either: it returns every time the deck is drawn. So it
     can also be settled as the single photograph it turned out to be, **kept as a 2D photo** or
     **rejected**, with the verdict recorded against the frame rather than the synthetic unit id so
     that it actually stays settled. Judging a half is only dangerous while the pair might still be
     completed; once it is deliberately called a single, deciding it is the point.

     The card also carries a link into each album worth checking: the one
     the frame is in, and the one its other eye should have been in. Whether that eye was never
     imported, went into a third album, or is sitting right there under a name the matcher could not
     tie to this frame is a question about the _library_, not one the app can settle, so the card's
     job ends at putting it one tap away in Lightroom. (A both-eyes album searched itself, so it
     offers one link rather than the same one twice.)

   - **Either album still being read** — the frame is withheld and nothing is said about it. It
     returns as a whole pair, or as a card, once the scan can tell the two apart.

   The card replaces silently withholding _every_ leftover, which was the first design. Withholding
   was right about the verdict and wrong about the silence: a pairing that had stopped working — or
   was never set up, the commonest case of all — looked exactly like an album with nothing left to
   review, and nothing anywhere said otherwise. Gating on the scan keeps the correction from
   overshooting into the opposite fault: crying "missing" over an unfinished read. A genuinely mono
   frame in a left album is the price, and it is the right way round — a frame shown as an incomplete
   pair can still be reviewed whole later; a half judged alone is gone.

### In a both-eyes album, every group is a stereo set

The three clusterers are all asking the same question — _are these frames the same scene?_ — and
differ only in where they draw the line. `clusterStereo` is the strictest on hash (parallax must not
merge two scenes) and adds a GPS guard; `clusterBursts` allows a looser hash with no distance check;
`clusterPanos` matches a lateral slide. Their thresholds:

| detector | max Hamming | distance guard |
| -------- | ----------- | -------------- |
| stereo   | 16          | ≤ 30 m         |
| burst    | 24          | none           |

A **wide baseline makes exactly the pair they disagree about**, a drone's most of all: parallax puts
the two frames further apart than a re-shoot of one scene would be, and the positions further apart
than 30 m. Ranked by precedence — stereo first, then burst — such a pair fell past stereo into the
burst detector and arrived in review as _"which is better, A or B?"_: a duel between the two eyes of
one photograph, where the honest answer is neither and either verdict loses the other half for good.

So in a stereo album the three are **unioned rather than ranked**, overlapping clusters are merged
(`mergeOverlappingSets`), and every result is stored as `type: 'stereo'`. No burst and no panorama
can be produced for such an album at all — the marking is the ground truth about what its frames
are, and the detectors only disagree about a threshold. Frames with no camera EXIF are held out of
all three, not just the stereo one, so a derived stereograph cannot be pulled in through the looser
burst threshold.

Selection applies the same re-typing to already-stored groups (`DailyUnitsService`). Marking an album
drops its manifest so the next scan re-detects it, but the groups on disk stay as they were until
that scan runs, and the deck should stop duelling a shot against itself the moment the album is
marked — not a scan later.

### A both-eyes album has the same gap, without the sides

An album marked as holding **both** eyes is paired in-album by `clusterStereo` during the scan, not
here — but a frame it leaves ungrouped is the same thing as an unmatched left frame, and is treated
the same way. Detection hashes _every_ image in a stereo album (the time-cluster gate is skipped for
them, since a stereo set is not time-bounded), so once the album is scanned to the end, "nothing in
this album pairs with this frame" is a fact about the album rather than about the cursor.

The one thing that cannot be said is **which** eye it is: both came out of one album and nothing
recorded the side. So the gap reports `missing: 'unknown'`, the card labels the empty slot `?` rather
than `L` or `R`, and it says only that nothing else in the album pairs with the frame.

The known miss: a _derived_ stereograph — an already-combined side-by-side image exported back into
the album — carries no camera EXIF, so `clusterStereo` deliberately excludes it, and it therefore
reads here as a frame that paired with nothing. It is a finished picture, not a half, and it will be
shown as an incomplete pair anyway. Telling the two apart needs a signal the stored `AssetMeta` does
not carry (make/model, or the doubled aspect ratio in the aspect store); until it does, the error
falls on the side of showing too much rather than silently dropping a real half.

Both inputs are already on device: `AssetMeta` carries `taken` and `serial`, and the luma hashes sit
in the hash store. No new fetching, so this is as cheap to re-run as the in-album detectors.

### Where a cross-album group lives

`DetectedGroup.sourceAlbumId` is singular, the manifest change-gate is per album, and
`withdrawAlbum` pulls one album's undecided units. A pair spanning two albums has no obvious home.
Two options:

- **Precompute and pick an owner** (the left album), re-running when _either_ album's manifest
  changes. Fits the rest of the pipeline, but every store and gate grows a two-album case.
- **Pair lazily at hydration** — keep detection per-album, leave the left album's frames as singles,
  and have the unit builder pull the partner frame when it builds the card.

Prefer the lazy route to start. The whole point of caching detection is that finding a group is
expensive; here the pairing rule is known up front, so there is far less to save than with in-album
clustering, and it avoids teaching every store about groups that straddle albums.

### Hydration is nearly free

Two albums shot on two bodies means two serials in the pair, which is exactly the twin-rig branch of
`hydrateStereo` — it already picks the left eye by serial and honours the per-album `stereoLeftSerial`
override. It only misses when both albums came off the _same_ body (a left pass, then a right pass):
the serials match and the fallback makes the first frame the left eye, which is a coin flip. Then the
album's role has to reach the hydrator, so "which album did this frame come from" decides the eye.

### Review rules

Neither side of a pair is ever offered alone: the right album is hidden wholesale and the left
album contributes only the frames that actually paired. A `left` or `right` album must never be
reviewed on its own — judging a lone eye means deciding on
half a photograph, and the verdict would keep that eye out of any future selection so the pair could
never be shown whole. That is the rule `withdrawAlbum` already implements for stereo albums; roles
extend it to both albums of a pair.

### Order of work

1. **Roles + UI** ✅ done — an album is marked `both` / `left` / `right` (`stereoAlbumRoles`,
   name-keyed like the old flag), from a pill that cycles in the album manager and above the review
   card. `StereoAlbumsService` owns what a mark implies: drop the album's manifest so the change gate
   looks again, and withdraw its undecided frames from today's deck. Only a `both` album is scanned
   for in-album stereo sets.
2. **The pair link** ✅ done — `stereoPartners` maps left album name → right album name, one
   direction so a pairing cannot contradict itself, with the album manager offering a partner picker
   under a left album and naming the claimant under a right one. A right album can be claimed once:
   naming it takes it off whichever left album had it, and every album whose pairing changed is
   re-detected. Roles and links are kept consistent — an album that stops being `left` loses its
   partner, one that stops being `right` is dropped from whoever pointed at it.
3. **The matcher + lazy hydration** ✅ done — `stereo-pairs.ts` (pure: vote for the clock offset,
   then match within a tolerance of it, hashes as a veto when both frames have one) and
   `split-stereo.ts` (per-queue pairing, no new stores). `DailyUnitsService` applies it when the
   queue is built, and `hydrateStereo` takes the left eye from the album a frame came from rather
   than guessing from serials. Changing a role or a link re-groups both albums: manifest dropped,
   queued units dropped, today's deck withdrawn — without which the standing 200-unit queue keeps
   serving the singles it was drawn with. Thresholds are provisional, and none of it has met a real
   split shoot yet.

Worth being honest about the order: the stereo _card_ still runs on `MOCK_STEREO`, so in-album stereo
detection has not been proven against a real catalog. Prove that first — a split-album matcher built
on unvalidated thresholds inherits every one of their errors.

## Benchmark corpus (future, for tuning Slice 3)

The Slice-1 unit tests use synthetic hashes — they prove the _logic_, not that the _thresholds_
(`windowMs`, `maxHamming`, `minSize`, and the pano/stereo equivalents) match real bursts/panos. Plan
a labeled corpus of **real photos exported small** (≈256–512px, the hash source size), organized by
expected grouping (burst / pano / stereo / A-vs-B / single), committed under `fixtures/`. A spec
hashes them through real `hashImageBlob` and asserts the detected groups match the labels, tracking
precision/recall so threshold or hash changes don't silently regress. Add this when building Slice 3,
where real thresholds start to matter.
