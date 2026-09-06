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
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
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

    /**
     * Files photos into one of the Keeper albums — where a sorted verdict finally becomes something
     * outside this app.
     *
     * <p>Retrying is safe but not free: Lightroom refuses a photo already in the album with a 403
     * rather than accepting it quietly, so a single-asset call that says "already in album" is
     * reported as success. A batch is not — its response cannot say which members were new.
     */
    @PostMapping("/albums/{albumId}/assets")
    public ResponseEntity<Void> fileIntoAlbum(
            @RequestHeader("X-Auth-Token") String authToken,
            @RequestHeader("X-Catalog-Id") String catalogId,
            @PathVariable String albumId,
            @RequestBody List<String> assetIds) {
        lightroomService.addAssetsToAlbum(authToken, catalogId, albumId, assetIds);
        return ResponseEntity.noContent().build();
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


        // The client keeps its own durable copy of every rendition it asks for, with its own
        // eviction policy, so a second copy in the WebView's HTTP cache is duplication that nothing
        // reads and nothing manages. Measured on a device it was the larger copy by far: 307 MB of
        // cache against 49 MB of app data. Without a header the cache stores the response anyway
        // and revalidates it later, so declining has to be explicit.

        // Pass the upstream status through rather than stamping 200 on everything. Lightroom does
        // not always have a rendition ready for an asset — RAW originals especially — and answering
        // "200, zero bytes" told the client it had a picture when it had nothing, which it then
        // cached. A non-2xx, or a 2xx with an empty body, has to reach the caller as a failure.
        byte[] body = upstream.getBody();
        if (!upstream.getStatusCode().is2xxSuccessful() || body == null || body.length == 0) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        }
        return new ResponseEntity<>(body, headers, upstream.getStatusCode());
    }
}
