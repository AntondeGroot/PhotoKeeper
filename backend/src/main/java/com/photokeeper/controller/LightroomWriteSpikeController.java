package com.photokeeper.controller;

import com.photokeeper.service.LightroomWriteSpikeService;
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
            // Use the supplied asset if any, else just grab one from the catalog so the spike is one-click.
            String asset = (assetId != null && !assetId.isBlank())
                    ? assetId
                    : writeSpike.firstAssetId(authToken, catalogId);
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
            String asset = (assetId != null && !assetId.isBlank())
                    ? assetId
                    : writeSpike.firstAssetId(authToken, catalogId);
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
                    "ok", false,
                    "status", e.getStatusCode().value(),
                    "error", e.getResponseBodyAsString()));
        }
    }
}
