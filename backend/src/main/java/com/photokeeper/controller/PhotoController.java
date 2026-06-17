package com.photokeeper.controller;

import com.photokeeper.model.AlbumSummary;
import com.photokeeper.service.LightroomService;
import com.photokeeper.service.PhotoFeedService;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Stateless Lightroom proxy. The device holds its own tokens and catalog id and passes them on every
 * request: the access token as {@code X-Auth-Token}, the catalog id as {@code X-Catalog-Id} (which
 * it fetches once via {@code /catalog}). A missing header is rejected as 401 by GlobalExceptionHandler.
 */
@RestController
@RequestMapping("/api")
public class PhotoController {

    private final LightroomService lightroomService;
    private final PhotoFeedService photoFeedService;

    public PhotoController(LightroomService lightroomService, PhotoFeedService photoFeedService) {
        this.lightroomService = lightroomService;
        this.photoFeedService = photoFeedService;
    }

    @GetMapping("/catalog")
    public ResponseEntity<Map<String, Object>> catalog(
            @RequestHeader("X-Auth-Token") String authToken) {
        return ResponseEntity.ok(lightroomService.getCatalog(authToken));
    }

    @GetMapping("/photos")
    public ResponseEntity<Map<String, Object>> photos(
            @RequestHeader("X-Auth-Token") String authToken,
            @RequestHeader("X-Catalog-Id") String catalogId,
            @RequestParam(defaultValue = "20") int limit) {
        return ResponseEntity.ok(lightroomService.getAssets(authToken, catalogId, limit));
    }

    @GetMapping("/albums")
    public ResponseEntity<List<AlbumSummary>> albums(
            @RequestHeader("X-Auth-Token") String authToken,
            @RequestHeader("X-Catalog-Id") String catalogId) {
        return ResponseEntity.ok(lightroomService.getAlbums(authToken, catalogId));
    }

    @GetMapping("/albums/{albumId}/assets")
    public ResponseEntity<Map<String, Object>> albumAssets(
            @RequestHeader("X-Auth-Token") String authToken,
            @RequestHeader("X-Catalog-Id") String catalogId,
            @PathVariable String albumId) {
        List<Map<String, Object>> assets =
                lightroomService.getAllAlbumAssets(authToken, catalogId, albumId);
        return ResponseEntity.ok(Map.of("resources", assets));
    }

    @GetMapping("/feed")
    public ResponseEntity<Map<String, Object>> feed(
            @RequestHeader("X-Auth-Token") String authToken,
            @RequestHeader("X-Catalog-Id") String catalogId,
            @RequestParam(name = "vacationAlbums", defaultValue = "") String vacationAlbums,
            @RequestParam(defaultValue = "20") int limit) {
        Set<String> vacationIds = vacationAlbums.isBlank()
                ? Set.of()
                : Arrays.stream(vacationAlbums.split(","))
                        .map(String::trim)
                        .filter(s -> !s.isEmpty())
                        .collect(Collectors.toSet());
        List<Object> assets = photoFeedService.buildFeed(authToken, catalogId, vacationIds, limit);
        return ResponseEntity.ok(Map.of("resources", assets));
    }

    @GetMapping("/photos/{assetId}/rendition")
    public ResponseEntity<byte[]> rendition(
            @RequestHeader("X-Auth-Token") String authToken,
            @RequestHeader("X-Catalog-Id") String catalogId,
            @PathVariable String assetId,
            @RequestParam(defaultValue = "640") String size) {
        ResponseEntity<byte[]> upstream =
                lightroomService.getRendition(authToken, catalogId, assetId, size);

        HttpHeaders headers = new HttpHeaders();
        MediaType contentType = upstream.getHeaders().getContentType();
        headers.setContentType(contentType != null ? contentType : MediaType.IMAGE_JPEG);

        return new ResponseEntity<>(upstream.getBody(), headers, HttpStatus.OK);
    }
}
