package com.photokeeper.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.photokeeper.config.AdobeConfig;
import jakarta.annotation.Nullable;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

/**
 * Throwaway (lightroom-write-back): all the write calls behind the detection lab's write-spike buttons.
 * Kept as living validation of what Adobe's partner API can and can't write — see the top-level README
 * ("Lightroom write-back: what the API allows"). Deliberately separate from {@link LightroomService} so
 * the read service stays read-only (and lean); delete this whole file, the {@code /keeper/spike*}
 * endpoints, and {@code AlbumSpikeComponent} together once the real verdict→album-membership flow lands.
 *
 * <p>Confirmed findings (self-contained plumbing here, so it duplicates a little of the read service):
 * adding an existing asset to a user-made album works; creating an album via the API is blocked; and
 * setting a rating/flag on an existing asset is impossible (no update endpoint — the asset PUT is
 * create-only, so it returns 403 "duplicate asset already exists").
 */
@Service
public class LightroomWriteSpikeService {

    private static final String LR_API_BASE = "https://lr.adobe.io/v2";

    private final AdobeConfig config;
    private final RestClient restClient;
    private final ObjectMapper objectMapper;

    public LightroomWriteSpikeService(
            AdobeConfig config,
            RestClient.Builder restClientBuilder,
            ObjectMapper objectMapper,
            LightroomRateLimitInterceptor interceptor) {
        this.config = config;
        this.restClient = restClientBuilder.requestInterceptor(interceptor).build();
        this.objectMapper = objectMapper;
    }

    /** The id of any one asset in the catalog (the first the API returns), or null if the catalog is empty. */
    @Nullable
    public String firstAssetId(String accessToken, String catalogId) {
        Map<String, Object> parsed = parseJson(lrGet("/catalogs/" + catalogId + "/assets?limit=1", accessToken));
        if (parsed.get("resources") instanceof List<?> resources
                && !resources.isEmpty()
                && resources.get(0) instanceof Map<?, ?> first
                && first.get("id") instanceof String id) {
            return id;
        }
        return null;
    }

    /** The id of the user album (collection) named {@code name}, or null if the user hasn't made it yet. */
    @Nullable
    public String findAlbumByName(String accessToken, String catalogId, String name) {
        Map<String, Object> parsed =
                parseJson(lrGet("/catalogs/" + catalogId + "/albums?subtype=collection", accessToken));
        if (parsed.get("resources") instanceof List<?> resources) {
            for (Object item : resources) {
                if (item instanceof Map<?, ?> album
                        && "collection".equals(album.get("subtype"))
                        && album.get("id") instanceof String id
                        && album.get("payload") instanceof Map<?, ?> payload
                        && name.equals(payload.get("name"))) {
                    return id;
                }
            }
        }
        return null;
    }

    /** Adds assets to an album (the album-asset association is keyed by the asset id). Works. */
    public void addAssetsToAlbum(
            String accessToken, String catalogId, String albumId, List<String> assetIds) {
        String now = Instant.now().toString();
        List<Map<String, Object>> resources = assetIds.stream()
                .map(id -> Map.<String, Object>of(
                        "id", id, "payload", Map.of("userCreated", now, "userUpdated", now)))
                .toList();
        lrPut(
                "/catalogs/" + catalogId + "/albums/" + albumId + "/assets",
                Map.of("resources", resources),
                accessToken);
    }

    /**
     * Creates a brand-new album with a client-generated id, to show the partner scope canNOT create a
     * normal user (collection) album. Returns the new album id; read it back with {@link #getAlbumSubtype}.
     */
    public String createAlbum(String accessToken, String catalogId, String name, String subtype) {
        String albumId = UUID.randomUUID().toString().replace("-", "");
        String now = Instant.now().toString();
        Map<String, Object> body = Map.of(
                "subtype", subtype,
                "payload", Map.of("name", name, "userCreated", now, "userUpdated", now));
        lrPut("/catalogs/" + catalogId + "/albums/" + albumId, body, accessToken);
        return albumId;
    }

    /** Reads back one album's stored subtype (to see what the API actually persisted), or null if absent. */
    @Nullable
    public String getAlbumSubtype(String accessToken, String catalogId, String albumId) {
        Map<String, Object> parsed =
                parseJson(lrGet("/catalogs/" + catalogId + "/albums/" + albumId, accessToken));
        return parsed.get("subtype") instanceof String subtype ? subtype : null;
    }

    /** Reads back one asset's full record (id/subtype/payload), to inspect what fields Lightroom stores. */
    public Map<String, Object> getAsset(String accessToken, String catalogId, String assetId) {
        return parseJson(lrGet("/catalogs/" + catalogId + "/assets/" + assetId, accessToken));
    }

    /**
     * Attempts to set a star rating + pick/reject flag on one asset. This is IMPOSSIBLE via the partner
     * API — the asset PUT is create-only, so this always fails with 403 "duplicate asset already exists".
     * Kept to reproduce that boundary on demand. {@code subtype} is intentionally omitted (sending it is
     * an even more explicit create); rating/flag paths are best guesses that never get a chance to apply.
     */
    public void setAssetReview(
            String accessToken, String catalogId, String assetId, int rating, String flag) {
        String now = Instant.now().toString();
        Map<String, Object> payload = new HashMap<>();
        payload.put("userUpdated", now);
        payload.put("xmp", Map.of("xmp", Map.of("Rating", rating)));
        if (flag != null && !flag.isBlank()) {
            payload.put("pick", flag);
        }
        lrPut("/catalogs/" + catalogId + "/assets/" + assetId, Map.of("payload", payload), accessToken);
    }

    @Nullable
    private String lrPut(String path, Object body, String accessToken) {
        return restClient.put()
                .uri(LR_API_BASE + path)
                .header("Authorization", "Bearer " + accessToken)
                .header("X-API-Key", config.getClientId())
                .contentType(MediaType.APPLICATION_JSON)
                .body(body)
                .retrieve()
                .body(String.class);
    }

    private String lrGet(String path, String accessToken) {
        return restClient.get()
                .uri(LR_API_BASE + path)
                .header("Authorization", "Bearer " + accessToken)
                .header("X-API-Key", config.getClientId())
                .retrieve()
                .body(String.class);
    }

    // Adobe Lightroom API prefixes responses with "while(1){}" to prevent JSON hijacking.
    private Map<String, Object> parseJson(String raw) {
        if (raw == null) {
            throw new LightroomApiException("Empty response from Lightroom API");
        }
        String json = raw.replaceFirst("^while\\s*\\(\\s*1\\s*\\)\\s*\\{\\s*\\}\\s*", "").trim();
        try {
            return objectMapper.readValue(json, new TypeReference<>() {});
        } catch (Exception e) {
            throw new LightroomApiException("Failed to parse Lightroom response: " + e.getMessage(), e);
        }
    }
}
