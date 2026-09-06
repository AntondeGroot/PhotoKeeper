package com.photokeeper.controller;

import com.photokeeper.service.LightroomWriteSpikeService;
import jakarta.annotation.Nullable;
import java.util.List;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestClientResponseException;

/**
 * Throwaway (lightroom-write-back): the {@code /keeper/spike*} endpoints behind the detection lab's
 * write-spike buttons, kept as living validation of Adobe's partner-API write surface (see the top-level
 * README, "Lightroom write-back: what the API allows"). Split out of {@link PhotoController} so the real
 * proxy stays lean and tested; this whole file, {@link LightroomWriteSpikeService}, and
 * {@code AlbumSpikeComponent} are excluded from coverage and deleted together once the real
 * verdict→album-membership flow lands.
 */
@RestController
@RequestMapping("/api")
public class LightroomWriteSpikeController {

    private final LightroomWriteSpikeService writeSpike;

    public LightroomWriteSpikeController(LightroomWriteSpikeService writeSpike) {
        this.writeSpike = writeSpike;
    }

    /**
     * Runs the move a real verdict change would need: add to {@code from}, take it out again, add to
     * {@code to} — and reports what each step said.
     *
     * <p>Filing currently accumulates. A photo sent to KeeperEdit and later promoted to print reaches
     * KeeperPrint but stays in KeeperEdit, because nothing has established whether an asset can be
     * taken out of an album at all. Each plausible removal shape is tried and its raw error kept, so
     * the answer is "none of these work, here is what each said" rather than one guess.
     *
     * <p>It writes to the real catalogue. If every removal shape fails the asset is left in
     * {@code from} as well as {@code to}, and the report says so — remove it by hand.
     */
    @PostMapping("/keeper/spike/move")
    public ResponseEntity<Map<String, Object>> moveSpike(
            @RequestHeader("X-Auth-Token") String authToken,
            @RequestHeader("X-Catalog-Id") String catalogId,
            @RequestParam(defaultValue = "SpikeA") String from,
            @RequestParam(defaultValue = "SpikeB") String to,
            @RequestParam(required = false) String assetId) {
        try {
            String fromId = writeSpike.findAlbumByName(authToken, catalogId, from);
            String toId = writeSpike.findAlbumByName(authToken, catalogId, to);
            if (fromId == null || toId == null) {
                return ResponseEntity.ok(Map.of(
                        "ok", false,
                        "error", "Both '" + from + "' and '" + to
                                + "' must exist in Lightroom before this can run."));
            }
            String asset = chooseAsset(authToken, catalogId, assetId);
            if (asset == null) {
                return ResponseEntity.ok(Map.of("ok", false, "error", "No asset to move."));
            }

            String addFailure = addTolerantly(authToken, catalogId, fromId, asset);
            if (addFailure != null) {
                return ResponseEntity.ok(addBlockedReport(from, asset, addFailure));
            }

            List<Map<String, String>> removal =
                    writeSpike.probeRemoval(authToken, catalogId, fromId, asset);

            // Tolerated rather than guarded: the asset may already be in the destination from an
            // earlier run, and that must not discard the removal answer we just paid for.
            String moveFailure = addTolerantly(authToken, catalogId, toId, asset);

            return ResponseEntity.ok(moveReport(from, to, asset, removal, moveFailure));
        } catch (RestClientResponseException e) {
            return ResponseEntity.ok(Map.of(
                    "spike", "album",
                    "ok", false,
                    "status", e.getStatusCode().value(),
                    "error", e.getResponseBodyAsString()));
        }
    }

    /** The asset asked for, or any asset from the catalogue so the spike stays one-click. */
    @Nullable
    private String chooseAsset(String authToken, String catalogId, @Nullable String assetId) {
        if (assetId != null && !assetId.isBlank()) {
            return assetId;
        }
        return writeSpike.firstAssetId(authToken, catalogId);
    }

    /** Nothing was moved, because the asset never reached the source album — removal stays unknown. */
    private Map<String, Object> addBlockedReport(String from, String asset, String failure) {
        return Map.of(
                "spike", "move",
                "ok", false,
                "asset", asset,
                "step", "add to " + from,
                "error", failure,
                "note", "Could not put the asset in the album, so removal is still unknown."
                        + " If this says 'cannot be a stack', pass a plain image via assetId"
                        + " — analyse an album in the lab first and it uses that frame.");
    }

    /** What every removal shape answered, and what state that leaves the asset in. */
    private Map<String, Object> moveReport(
            String from,
            String to,
            String asset,
            List<Map<String, String>> removal,
            @Nullable String moveFailure) {
        boolean removed = removal.stream().anyMatch(a -> "ok".equals(a.get("result")));
        return Map.of(
                "spike", "move",
                "ok", true,
                "asset", asset,
                "addedTo", List.of(from, to),
                "addToDestination", moveFailure == null ? "ok" : moveFailure,
                "removalWorks", removed,
                "removalAttempts", removal,
                "note", removed
                        ? "Removal works — a verdict change can move a photo rather than copy it."
                        : "Removal failed every way. The asset is now in BOTH albums; take it out"
                                + " of '" + from + "' by hand.");
    }

    /**
     * Adds the asset, treating "already in album" as the state we wanted rather than a failure.
     *
     * Returns null when the asset is in the album afterwards, or the raw error when it is not — a
     * stack, most often, which says nothing about removal.
     */
    @Nullable
    private String addTolerantly(String authToken, String catalogId, String albumId, String asset) {
        try {
            writeSpike.addAssetsToAlbum(authToken, catalogId, albumId, List.of(asset));
            return null;
        } catch (RestClientResponseException e) {
            String body = e.getResponseBodyAsString();
            return body.contains("already in album") ? null : e.getStatusCode().value() + " " + body;
        }
    }

    /**
     * Verifies we can add an asset to a *user-created* Lightroom album. The user makes a normal album named
     * {@code name} themselves (so it's visible/exportable); this finds it by name and, when an
     * {@code assetId} is given, adds that asset to it. Returns the album id, an instruction if the album
     * doesn't exist yet, or the raw Lightroom error when a write is rejected. This one works.
     */
    @PostMapping("/keeper/spike")
    public ResponseEntity<Map<String, Object>> keeperSpike(
            @RequestHeader("X-Auth-Token") String authToken,
            @RequestHeader("X-Catalog-Id") String catalogId,
            @RequestParam String name,
            @RequestParam(required = false) String assetId) {
        try {
            String albumId = writeSpike.findAlbumByName(authToken, catalogId, name);
            if (albumId == null) {
                return ResponseEntity.ok(Map.of(
                        "ok", false,
                        "error", "No album named '" + name
                                + "' found — create it in Lightroom first (a normal album), then retry."));
            }
            String asset = chooseAsset(authToken, catalogId, assetId);
            if (asset != null) {
                writeSpike.addAssetsToAlbum(authToken, catalogId, albumId, List.of(asset));
            }
            return ResponseEntity.ok(Map.of(
                    "ok", true,
                    "albumId", albumId,
                    "name", name,
                    "assetAdded", asset != null,
                    "assetId", asset != null ? asset : ""));
        } catch (RestClientResponseException e) {
            return ResponseEntity.ok(Map.of(
                    "spike", "create-album",
                    "ok", false,
                    "status", e.getStatusCode().value(),
                    "error", e.getResponseBodyAsString()));
        }
    }

    /**
     * Creates a brand-new album via the API and reads back the subtype that actually persisted — proving
     * the partner scope canNOT create a *user-visible* album (collection). Returns the raw Lightroom error
     * on rejection. Kept to reproduce that boundary on demand.
     */
    @PostMapping("/keeper/spike/create-album")
    public ResponseEntity<Map<String, Object>> keeperCreateAlbum(
            @RequestHeader("X-Auth-Token") String authToken,
            @RequestHeader("X-Catalog-Id") String catalogId,
            @RequestParam String name,
            @RequestParam(defaultValue = "project") String subtype) {
        try {
            String albumId = writeSpike.createAlbum(authToken, catalogId, name, subtype);
            String landed = writeSpike.getAlbumSubtype(authToken, catalogId, albumId);
            return ResponseEntity.ok(Map.of(
                    "ok", true,
                    "albumId", albumId,
                    "name", name,
                    "requestedSubtype", subtype,
                    "landedSubtype", landed != null ? landed : ""));
        } catch (RestClientResponseException e) {
            return ResponseEntity.ok(Map.of(
                    "spike", "review",
                    "ok", false,
                    "status", e.getStatusCode().value(),
                    "error", e.getResponseBodyAsString()));
        }
    }

    /**
     * Attempts to set a star rating + pick/reject flag on one asset, reading it back before and after.
     * This is IMPOSSIBLE via the partner API — the asset PUT is create-only, so it always returns 403
     * "duplicate asset already exists". Pass {@code assetId} to target a specific asset; omitted, it uses
     * the catalog's first asset. Kept to reproduce that boundary on demand.
     */
    @PostMapping("/keeper/spike/review")
    public ResponseEntity<Map<String, Object>> keeperReview(
            @RequestHeader("X-Auth-Token") String authToken,
            @RequestHeader("X-Catalog-Id") String catalogId,
            @RequestParam(required = false) String assetId,
            @RequestParam(defaultValue = "5") int rating,
            @RequestParam(defaultValue = "pick") String flag) {
        try {
            String asset = chooseAsset(authToken, catalogId, assetId);
            if (asset == null) {
                return ResponseEntity.ok(Map.of("ok", false, "error", "Catalog has no assets to write to."));
            }
            Map<String, Object> before = writeSpike.getAsset(authToken, catalogId, asset);
            writeSpike.setAssetReview(authToken, catalogId, asset, rating, flag);
            Map<String, Object> after = writeSpike.getAsset(authToken, catalogId, asset);
            return ResponseEntity.ok(Map.of(
                    "ok", true,
                    "assetId", asset,
                    "requestedRating", rating,
                    "requestedFlag", flag,
                    "beforePayload", before.getOrDefault("payload", Map.of()),
                    "afterPayload", after.getOrDefault("payload", Map.of())));
        } catch (RestClientResponseException e) {
            return ResponseEntity.ok(Map.of(
                    "spike", "move",
                    "ok", false,
                    "status", e.getStatusCode().value(),
                    "error", e.getResponseBodyAsString()));
        }
    }
}
