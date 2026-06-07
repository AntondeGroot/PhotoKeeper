package com.photokeeper.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.photokeeper.config.AdobeConfig;
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

    public String exchangeCode(String code) {
        MultiValueMap<String, String> body = new LinkedMultiValueMap<>();
        body.add("grant_type", "authorization_code");
        body.add("client_id", config.getClientId());
        body.add("client_secret", config.getClientSecret());
        body.add("redirect_uri", config.getRedirectUri());
        body.add("code", code);

        Map<String, Object> response = restClient.post()
                .uri(IMS_TOKEN_URL)
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .body(body)
                .retrieve()
                .body(MAP_TYPE);

        if (response == null || !response.containsKey("access_token")) {
            throw new RuntimeException("Token exchange failed: no access_token in response");
        }
        return (String) response.get("access_token");
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
            throw new RuntimeException("Empty response from Lightroom API");
        }
        String json = raw.replaceFirst("^while\\s*\\(\\s*1\\s*\\)\\s*\\{\\s*\\}\\s*", "").trim();
        log.debug("Lightroom raw response (trimmed): {}", json.length() > 200 ? json.substring(0, 200) + "…" : json);
        try {
            return objectMapper.readValue(json, new TypeReference<>() {});
        } catch (Exception e) {
            throw new RuntimeException("Failed to parse Lightroom response: " + e.getMessage(), e);
        }
    }
}
