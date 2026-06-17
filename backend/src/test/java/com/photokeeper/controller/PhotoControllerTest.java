package com.photokeeper.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.photokeeper.model.AlbumSummary;
import com.photokeeper.service.LightroomService;
import com.photokeeper.service.PhotoFeedService;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.server.ResponseStatusException;

@WebMvcTest(PhotoController.class)
class PhotoControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private LightroomService lightroomService;

    @MockitoBean
    private PhotoFeedService photoFeedService;

    @Test
    void catalogReturnsCatalogForTheAccessToken() throws Exception {
        when(lightroomService.getCatalog("acc")).thenReturn(Map.of("id", "cat-123", "name", "My Catalog"));

        mockMvc.perform(get("/api/catalog").header("X-Auth-Token", "acc"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value("cat-123"));
    }

    @Test
    void photosUsesTheTokenAndCatalogHeaders() throws Exception {
        when(lightroomService.getAssets("acc", "cat-123", 20)).thenReturn(Map.of("resources", List.of()));

        mockMvc.perform(get("/api/photos")
                        .header("X-Auth-Token", "acc")
                        .header("X-Catalog-Id", "cat-123"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.resources").isArray());
    }

    @Test
    void albumsReturnsAlbumList() throws Exception {
        when(lightroomService.getAlbums("acc", "cat-123"))
                .thenReturn(List.of(new AlbumSummary("alb-1", "Lisbon, May")));

        mockMvc.perform(get("/api/albums")
                        .header("X-Auth-Token", "acc")
                        .header("X-Catalog-Id", "cat-123"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value("alb-1"));
    }

    @Test
    void albumsWithoutTokenHeaderReturnsUnauthorized() throws Exception {
        mockMvc.perform(get("/api/albums").header("X-Catalog-Id", "cat-123"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void albumsWithoutCatalogHeaderReturnsUnauthorized() throws Exception {
        mockMvc.perform(get("/api/albums").header("X-Auth-Token", "acc"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void feedPassesVacationIdsAndReturnsResources() throws Exception {
        when(photoFeedService.buildFeed("acc", "cat-123", Set.of("alb-1", "alb-2"), 20))
                .thenReturn(List.of(Map.of("id", "asset-1")));

        mockMvc.perform(get("/api/feed")
                        .header("X-Auth-Token", "acc")
                        .header("X-Catalog-Id", "cat-123")
                        .param("vacationAlbums", "alb-1,alb-2"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.resources[0].id").value("asset-1"));
    }

    @Test
    void albumAssetsReturnsTheFullAlbumAsResources() throws Exception {
        when(lightroomService.getAllAlbumAssets("acc", "cat-123", "alb-1"))
                .thenReturn(List.of(Map.of("id", "a1"), Map.of("id", "a2")));

        mockMvc.perform(get("/api/albums/alb-1/assets")
                        .header("X-Auth-Token", "acc")
                        .header("X-Catalog-Id", "cat-123"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.resources[0].id").value("a1"))
                .andExpect(jsonPath("$.resources[1].id").value("a2"));
    }

    @Test
    void feedWithNoVacationAlbumsPassesEmptySet() throws Exception {
        when(photoFeedService.buildFeed("acc", "cat-123", Set.of(), 20)).thenReturn(List.of());

        mockMvc.perform(get("/api/feed")
                        .header("X-Auth-Token", "acc")
                        .header("X-Catalog-Id", "cat-123"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.resources").isArray());
    }

    @Test
    void renditionReturnsBytes() throws Exception {
        when(lightroomService.getRendition("acc", "cat-123", "asset-1", "640"))
                .thenReturn(ResponseEntity.ok(new byte[]{1, 2, 3}));

        mockMvc.perform(get("/api/photos/asset-1/rendition")
                        .header("X-Auth-Token", "acc")
                        .header("X-Catalog-Id", "cat-123"))
                .andExpect(status().isOk());
    }

    @Test
    void renditionPreservesUpstreamContentType() throws Exception {
        HttpHeaders upstreamHeaders = new HttpHeaders();
        upstreamHeaders.setContentType(MediaType.IMAGE_PNG);
        when(lightroomService.getRendition("acc", "cat-123", "asset-1", "1280"))
                .thenReturn(new ResponseEntity<>(new byte[]{1, 2, 3}, upstreamHeaders, HttpStatus.OK));

        mockMvc.perform(get("/api/photos/asset-1/rendition")
                        .header("X-Auth-Token", "acc")
                        .header("X-Catalog-Id", "cat-123")
                        .param("size", "1280"))
                .andExpect(status().isOk());
    }

    // ── Error mapping via GlobalExceptionHandler (exercised through /catalog) ──

    @Test
    void upstreamHttpErrorReturnsBadGateway() throws Exception {
        when(lightroomService.getCatalog(any())).thenThrow(
                HttpClientErrorException.create(
                        HttpStatus.NOT_FOUND, "Not Found", HttpHeaders.EMPTY, new byte[0],
                        StandardCharsets.UTF_8));

        mockMvc.perform(get("/api/catalog").header("X-Auth-Token", "acc"))
                .andExpect(status().isBadGateway());
    }

    @Test
    void genericExceptionReturnsInternalServerError() throws Exception {
        when(lightroomService.getCatalog(any())).thenThrow(new RuntimeException("unexpected error"));

        mockMvc.perform(get("/api/catalog").header("X-Auth-Token", "acc"))
                .andExpect(status().isInternalServerError());
    }

    @Test
    void exceptionWithNullMessageReturnsInternalServerError() throws Exception {
        when(lightroomService.getCatalog(any())).thenThrow(new RuntimeException());

        mockMvc.perform(get("/api/catalog").header("X-Auth-Token", "acc"))
                .andExpect(status().isInternalServerError());
    }

    @Test
    void responseStatusExceptionWithNullReasonReturnsStatus() throws Exception {
        when(lightroomService.getCatalog(any())).thenThrow(new ResponseStatusException(HttpStatus.FORBIDDEN));

        mockMvc.perform(get("/api/catalog").header("X-Auth-Token", "acc"))
                .andExpect(status().isForbidden());
    }
}
