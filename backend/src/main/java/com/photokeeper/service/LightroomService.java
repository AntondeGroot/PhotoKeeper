package com.photokeeper.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.photokeeper.config.AdobeConfig;
import com.photokeeper.model.AlbumSummary;
import jakarta.annotation.Nullable;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

@Service
public class LightroomService {

    private static final Logger log = LoggerFactory.getLogger(LightroomService.class);
    private static final String LR_API_BASE = "https://lr.adobe.io/v2";
    private static final String LR_CATALOGS = LR_API_BASE + "/catalogs";

    // Safety cap so a malformed/looping next-link can't page forever.
    private static final int MAX_ALBUM_PAGES = 50;

    private final AdobeConfig config;
    private final RestClient restClient;
    private final ObjectMapper objectMapper;

    public LightroomService(
            AdobeConfig config,
            RestClient.Builder restClientBuilder,
            ObjectMapper objectMapper,
            LightroomRateLimitInterceptor interceptor) {
        this.config = config;
        // The interceptor paces every Lightroom call under Adobe's RPS ceiling and retries 429s.
        this.restClient = restClientBuilder.requestInterceptor(interceptor).build();
        this.objectMapper = objectMapper;
    }

    public Map<String, Object> getCatalog(String accessToken) {
        String raw = lrGet("/catalog", accessToken);
        Map<String, Object> result = parseJson(raw);
        log.debug("Catalog: {}", result);
        return result;
    }

    public Map<String, Object> getAssets(String accessToken, String catalogId, int limit) {
        String raw = lrGet("/catalogs/" + catalogId + "/assets?limit=" + limit, accessToken);
        return parseJson(raw);
    }

    /**
     * Lists the catalog's albums, keeping only real albums (subtype "collection") and dropping
     * folders that group albums (subtype "collection_set").
     */
    public List<AlbumSummary> getAlbums(String accessToken, String catalogId) {
        // The Lightroom albums endpoint requires a subtype filter (see the catalog's
        // /rels/subtyped_albums templated link); "collection" = actual albums (vs collection_set
        // folders). Without it the API returns no albums.
        String raw = lrGet("/catalogs/" + catalogId + "/albums?subtype=collection", accessToken);
        Map<String, Object> parsed = parseJson(raw);

        List<AlbumSummary> albums = new ArrayList<>();
        if (parsed.get("resources") instanceof List<?> resources) {
            for (Object item : resources) {
                if (!(item instanceof Map<?, ?> album) || !"collection".equals(album.get("subtype"))) {
                    continue;
                }
                if (album.get("id") instanceof String id
                        && album.get("payload") instanceof Map<?, ?> payload
                        && payload.get("name") instanceof String name) {
                    albums.add(new AlbumSummary(id, name));
                }
            }
        }
        return albums;
    }

    /**
     * Returns the assets that belong to a single album. The album-assets response wraps each asset
     * under an "asset" field, which is unwrapped here so callers get plain asset objects (the same
     * shape as {@link #getAssets}'s resources).
     */
    public List<Map<String, Object>> getAlbumAssets(
            String accessToken, String catalogId, String albumId, int limit) {
        // embed=asset is required, otherwise each resource's "asset" is just a stub (id + links) with
        // no subtype/payload — the catalog's /rels/album_assets link spells this out.
        Map<String, Object> parsed = parseJson(lrGet(
                "/catalogs/" + catalogId + "/albums/" + albumId + "/assets?embed=asset&limit=" + limit,
                accessToken));

        List<Map<String, Object>> assets = new ArrayList<>();
        unwrapAssets(parsed, assets);
        return assets;
    }

    /**
     * Returns every asset in an album, following Lightroom's {@code links.next} pagination cursor so
     * large albums come back complete (vs the single page {@link #getAlbumAssets} returns). Used by
     * the background detection scan, which needs the full population to find bursts.
     */
    public List<Map<String, Object>> getAllAlbumAssets(String accessToken, String catalogId, String albumId) {
        String base = LR_API_BASE + "/catalogs/" + catalogId + "/";
        String url = base + "albums/" + albumId + "/assets?embed=asset";

        List<Map<String, Object>> assets = new ArrayList<>();
        for (int page = 0; url != null && page < MAX_ALBUM_PAGES; page++) {
            Map<String, Object> parsed = parseJson(lrGetUrl(url, accessToken));
            unwrapAssets(parsed, assets);
            url = nextPageUrl(parsed, base);
        }
        return assets;
    }

    @SuppressWarnings("unchecked")
    private static void unwrapAssets(Map<String, Object> parsed, List<Map<String, Object>> out) {
        if (parsed.get("resources") instanceof List<?> resources) {
            for (Object item : resources) {
                if (item instanceof Map<?, ?> res && res.get("asset") instanceof Map<?, ?> asset) {
                    out.add((Map<String, Object>) asset);
                }
            }
        }
    }

    /** Resolves the next-page URL from a response's {@code links.next.href} (relative to the catalog). */
    @Nullable
    private static String nextPageUrl(Map<String, Object> parsed, String base) {
        if (parsed.get("links") instanceof Map<?, ?> links
                && links.get("next") instanceof Map<?, ?> next
                && next.get("href") instanceof String href
                && !href.isBlank()) {
            return href.startsWith("http") ? href : base + href;
        }
        return null;
    }

    public ResponseEntity<byte[]> getRendition(String accessToken, String catalogId, String assetId, String size) {
        return restClient.get()
                .uri(LR_CATALOGS + "/{catalogId}/assets/{assetId}/renditions/{size}",
                        catalogId, assetId, size)
                .header("Authorization", "Bearer " + accessToken)
                .header("X-API-Key", config.getClientId())
                .retrieve()
                .toEntity(byte[].class);
    }

    /**
     * Files assets into an album — the only durable write the partner scope allows.
     *
     * <p>Ratings and flags cannot be written at all: the asset {@code PUT} is create-only and answers
     * 403 "duplicate asset already exists" (see {@code LightroomWriteSpikeService}, which reproduces
     * that boundary on demand). Album membership is therefore the whole of what a sorted verdict can
     * become in Lightroom, and it is enough — an album of photos to delete is the point of an
     * evening's sorting.
     *
     * <p>Adding is <em>not</em> idempotent, which is easy to assume and wrong: a photo already in the
     * album answers 403 {@code ResourceExistsError, "already in album"}, and one such member fails
     * the whole write with nothing applied. So a single-asset call that comes back with that error is
     * treated as done — the photo is in the album, which is the state the caller wanted — while a
     * batch is left to fail, because the response cannot say which of its members were new. The
     * client splits a failed batch and retries one at a time, and each of those gets a clean answer.
     */
    public void addAssetsToAlbum(
            String accessToken, String catalogId, String albumId, List<String> assetIds) {
        if (assetIds.isEmpty()) {
            return;
        }
        String now = Instant.now().toString();
        List<Map<String, Object>> resources = assetIds.stream()
                .map(id -> Map.<String, Object>of(
                        "id", id, "payload", Map.of("userCreated", now, "userUpdated", now)))
                .toList();
        try {
            restClient
                    .put()
                    .uri(LR_CATALOGS + "/{catalogId}/albums/{albumId}/assets", catalogId, albumId)
                    .header("Authorization", "Bearer " + accessToken)
                    .header("X-API-Key", config.getClientId())
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(Map.of("resources", resources))
                    .retrieve()
                    .toBodilessEntity();
        } catch (RestClientResponseException e) {
            if (assetIds.size() == 1 && isAlreadyInAlbum(e)) {
                log.debug("Asset {} was already in album {}", assetIds.getFirst(), albumId);
                return;
            }
            throw e;
        }
        log.info("Filed {} asset(s) into album {}", assetIds.size(), albumId);
    }

    /** Whether a rejection was Lightroom saying the photo is already where we were putting it. */
    private static boolean isAlreadyInAlbum(RestClientResponseException e) {
        String body = e.getResponseBodyAsString();
        return body.contains("ResourceExistsError") || body.contains("already in album");
    }

    private String lrGet(String path, String accessToken) {
        return lrGetUrl(LR_API_BASE + path, accessToken);
    }

    private String lrGetUrl(String url, String accessToken) {
        return restClient.get()
                .uri(url)
                .header("Authorization", "Bearer " + accessToken)
                .header("X-API-Key", config.getClientId())
                .retrieve()
                .body(String.class);
    }

    // Adobe Lightroom API prefixes responses with "while(1){}" to prevent JSON hijacking
    private Map<String, Object> parseJson(String raw) {
        if (raw == null) {
            throw new LightroomApiException("Empty response from Lightroom API");
        }
        String json = raw.replaceFirst("^while\\s*\\(\\s*1\\s*\\)\\s*\\{\\s*\\}\\s*", "").trim();
        log.debug("Lightroom raw response (trimmed): {}", json.length() > 200 ? json.substring(0, 200) + "…" : json);
        try {
            return objectMapper.readValue(json, new TypeReference<>() {});
        } catch (Exception e) {
            throw new LightroomApiException("Failed to parse Lightroom response: " + e.getMessage(), e);
        }
    }
}
