package com.photokeeper.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.photokeeper.config.AdobeConfig;
import com.photokeeper.model.AlbumSummary;
import com.photokeeper.model.TokenResponse;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestClient;

@Service
public class LightroomService {

    private static final Logger log = LoggerFactory.getLogger(LightroomService.class);
    private static final String IMS_TOKEN_URL = "https://ims-na1.adobelogin.com/ims/token/v3";
    private static final String LR_API_BASE = "https://lr.adobe.io/v2";
    private static final String LR_CATALOGS = LR_API_BASE + "/catalogs";

    private static final ParameterizedTypeReference<Map<String, Object>> MAP_TYPE =
            new ParameterizedTypeReference<>() {};

    private final AdobeConfig config;
    private final RestClient restClient;
    private final ObjectMapper objectMapper;

    public LightroomService(AdobeConfig config, RestClient.Builder restClientBuilder, ObjectMapper objectMapper) {
        this.config = config;
        this.restClient = restClientBuilder.build();
        this.objectMapper = objectMapper;
    }

    /** Exchanges an authorization code for the access + refresh token set (offline_access scope). */
    public TokenResponse exchangeCode(String code) {
        MultiValueMap<String, String> body = new LinkedMultiValueMap<>();
        body.add("grant_type", "authorization_code");
        body.add("client_id", config.getClientId());
        body.add("client_secret", config.getClientSecret());
        body.add("redirect_uri", config.getRedirectUri());
        body.add("code", code);

        Map<String, Object> response = postToken(body);
        String accessToken = accessTokenOf(response);
        if (!(response.get("refresh_token") instanceof String refreshToken)) {
            throw new LightroomApiException("Token exchange failed: no refresh_token in response");
        }
        return new TokenResponse(accessToken, refreshToken, expiresInOf(response));
    }

    /**
     * Exchanges a refresh token for a fresh access token. Adobe may rotate the refresh token; if it
     * doesn't return a new one, the caller's existing refresh token is carried over.
     */
    public TokenResponse refreshAccessToken(String refreshToken) {
        MultiValueMap<String, String> body = new LinkedMultiValueMap<>();
        body.add("grant_type", "refresh_token");
        body.add("client_id", config.getClientId());
        body.add("client_secret", config.getClientSecret());
        body.add("refresh_token", refreshToken);

        Map<String, Object> response = postToken(body);
        String newRefresh =
                response.get("refresh_token") instanceof String s ? s : refreshToken;
        return new TokenResponse(accessTokenOf(response), newRefresh, expiresInOf(response));
    }

    private Map<String, Object> postToken(MultiValueMap<String, String> body) {
        Map<String, Object> response = restClient.post()
                .uri(IMS_TOKEN_URL)
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .body(body)
                .retrieve()
                .body(MAP_TYPE);
        if (response == null) {
            throw new LightroomApiException("Adobe token endpoint returned an empty response");
        }
        return response;
    }

    private static String accessTokenOf(Map<String, Object> response) {
        if (!(response.get("access_token") instanceof String accessToken)) {
            throw new LightroomApiException("Token response has no access_token");
        }
        return accessToken;
    }

    private static long expiresInOf(Map<String, Object> response) {
        return response.get("expires_in") instanceof Number n ? n.longValue() : 0L;
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
    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> getAlbumAssets(
            String accessToken, String catalogId, String albumId, int limit) {
        // embed=asset is required, otherwise each resource's "asset" is just a stub (id + links) with
        // no subtype/payload — the catalog's /rels/album_assets link spells this out.
        String raw = lrGet(
                "/catalogs/" + catalogId + "/albums/" + albumId + "/assets?embed=asset&limit=" + limit,
                accessToken);
        Map<String, Object> parsed = parseJson(raw);

        List<Map<String, Object>> assets = new ArrayList<>();
        if (parsed.get("resources") instanceof List<?> resources) {
            for (Object item : resources) {
                if (item instanceof Map<?, ?> res && res.get("asset") instanceof Map<?, ?> asset) {
                    assets.add((Map<String, Object>) asset);
                }
            }
        }
        return assets;
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

    private String lrGet(String path, String accessToken) {
        return restClient.get()
                .uri(LR_API_BASE + path)
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
