package com.photokeeper.controller;

import com.photokeeper.model.TokenData;
import com.photokeeper.service.LightroomService;
import com.photokeeper.service.TokenStore;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;
import java.util.HashMap;

@RestController
@RequestMapping("/api")
public class PhotoController {

    private static final Logger log = LoggerFactory.getLogger(PhotoController.class);

    private final LightroomService lightroomService;
    private final TokenStore tokenStore;

    public PhotoController(LightroomService lightroomService, TokenStore tokenStore) {
        this.lightroomService = lightroomService;
        this.tokenStore = tokenStore;
    }

    @GetMapping("/catalog")
    public ResponseEntity<Map<String, Object>> catalog(
            @RequestHeader("X-Auth-Token") String authToken) {
        TokenData td = resolveToken(authToken);
        Map<String, Object> catalog = lightroomService.getCatalog(td.getAccessToken());
        if (td.getCatalogId() == null) {
            td.setCatalogId((String) catalog.get("id"));
        }
        return ResponseEntity.ok(catalog);
    }

    @GetMapping("/photos")
    public ResponseEntity<Map<String, Object>> photos(
            @RequestHeader("X-Auth-Token") String authToken,
            @RequestParam(defaultValue = "20") int limit) {
        TokenData td = resolveToken(authToken);
        ensureCatalog(td);
        Map<String, Object> assets = lightroomService.getAssets(td.getAccessToken(), td.getCatalogId(), limit);
        return ResponseEntity.ok(assets);
    }

    @GetMapping("/photos/{assetId}/rendition")
    public ResponseEntity<byte[]> rendition(
            @RequestHeader("X-Auth-Token") String authToken,
            @PathVariable String assetId,
            @RequestParam(defaultValue = "640") String size) {
        TokenData td = resolveToken(authToken);
        ensureCatalog(td);

        ResponseEntity<byte[]> upstream = lightroomService.getRendition(
                td.getAccessToken(), td.getCatalogId(), assetId, size);

        HttpHeaders headers = new HttpHeaders();
        MediaType contentType = upstream.getHeaders().getContentType();
        headers.setContentType(contentType != null ? contentType : MediaType.IMAGE_JPEG);

        return new ResponseEntity<>(upstream.getBody(), headers, HttpStatus.OK);
    }

    private TokenData resolveToken(String authToken) {
        return tokenStore.get(authToken)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid or expired token"));
    }

    private void ensureCatalog(TokenData td) {
        if (td.getCatalogId() == null) {
            Map<String, Object> catalog = lightroomService.getCatalog(td.getAccessToken());
            td.setCatalogId((String) catalog.get("id"));
        }
    }
}