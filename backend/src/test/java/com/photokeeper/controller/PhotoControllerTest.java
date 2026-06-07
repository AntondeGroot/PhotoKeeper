package com.photokeeper.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.photokeeper.model.TokenData;
import com.photokeeper.service.LightroomService;
import com.photokeeper.service.TokenStore;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
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
    private TokenStore tokenStore;

    private TokenData tokenData;

    @BeforeEach
    void setUp() {
        tokenData = new TokenData("access-token");
        tokenData.setCatalogId("cat-123");
        when(tokenStore.get("valid-token")).thenReturn(Optional.of(tokenData));
    }

    @Test
    void catalogWithValidTokenReturnsCatalog() throws Exception {
        Map<String, Object> catalog = Map.of("id", "cat-123", "name", "My Catalog");
        when(lightroomService.getCatalog("access-token")).thenReturn(catalog);

        mockMvc.perform(get("/api/catalog").header("X-Auth-Token", "valid-token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value("cat-123"));
    }

    @Test
    void catalogWithInvalidTokenReturnsUnauthorized() throws Exception {
        when(tokenStore.get("bad-token")).thenReturn(Optional.empty());

        mockMvc.perform(get("/api/catalog").header("X-Auth-Token", "bad-token"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void catalogWhenNullCatalogIdFetchesCatalogAndSetsId() throws Exception {
        TokenData tdNoCatalog = new TokenData("access-token");
        when(tokenStore.get("token-no-cat")).thenReturn(Optional.of(tdNoCatalog));
        when(lightroomService.getCatalog("access-token")).thenReturn(Map.of("id", "fetched-cat"));

        mockMvc.perform(get("/api/catalog").header("X-Auth-Token", "token-no-cat"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value("fetched-cat"));
    }

    @Test
    void photosWithValidTokenReturnsAssets() throws Exception {
        Map<String, Object> assets = Map.of("resources", List.of());
        when(lightroomService.getAssets("access-token", "cat-123", 20)).thenReturn(assets);

        mockMvc.perform(get("/api/photos").header("X-Auth-Token", "valid-token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.resources").isArray());
    }

    @Test
    void photosWithNullCatalogIdFetchesCatalogFirst() throws Exception {
        TokenData tdNoCatalog = new TokenData("access-token");
        when(tokenStore.get("token-no-cat")).thenReturn(Optional.of(tdNoCatalog));
        when(lightroomService.getCatalog("access-token")).thenReturn(Map.of("id", "fetched-cat"));
        when(lightroomService.getAssets("access-token", "fetched-cat", 20)).thenReturn(Map.of());

        mockMvc.perform(get("/api/photos").header("X-Auth-Token", "token-no-cat"))
                .andExpect(status().isOk());
    }

    @Test
    void renditionWithValidTokenReturnsBytes() throws Exception {
        when(lightroomService.getRendition("access-token", "cat-123", "asset-1", "640"))
                .thenReturn(ResponseEntity.ok(new byte[]{1, 2, 3}));

        mockMvc.perform(get("/api/photos/asset-1/rendition").header("X-Auth-Token", "valid-token"))
                .andExpect(status().isOk());
    }

    @Test
    void catalogWhenUpstreamThrowsHttpErrorReturnsBadGateway() throws Exception {
        when(lightroomService.getCatalog(any())).thenThrow(
                HttpClientErrorException.create(
                        HttpStatus.NOT_FOUND,
                        "Not Found",
                        HttpHeaders.EMPTY,
                        new byte[0],
                        StandardCharsets.UTF_8));

        mockMvc.perform(get("/api/catalog").header("X-Auth-Token", "valid-token"))
                .andExpect(status().isBadGateway());
    }

    @Test
    void catalogWhenGenericExceptionThrownReturnsInternalServerError() throws Exception {
        when(lightroomService.getCatalog(any())).thenThrow(new RuntimeException("unexpected error"));

        mockMvc.perform(get("/api/catalog").header("X-Auth-Token", "valid-token"))
                .andExpect(status().isInternalServerError());
    }

    @Test
    void catalogWhenExceptionHasNullMessageReturnsInternalServerError() throws Exception {
        when(lightroomService.getCatalog(any())).thenThrow(new RuntimeException());

        mockMvc.perform(get("/api/catalog").header("X-Auth-Token", "valid-token"))
                .andExpect(status().isInternalServerError());
    }

    @Test
    void catalogWhenResponseStatusHasNullReasonReturnsStatus() throws Exception {
        when(lightroomService.getCatalog(any())).thenThrow(
                new ResponseStatusException(HttpStatus.FORBIDDEN));

        mockMvc.perform(get("/api/catalog").header("X-Auth-Token", "valid-token"))
                .andExpect(status().isForbidden());
    }

    @Test
    void renditionPreservesUpstreamContentType() throws Exception {
        HttpHeaders upstreamHeaders = new HttpHeaders();
        upstreamHeaders.setContentType(MediaType.IMAGE_PNG);
        when(lightroomService.getRendition("access-token", "cat-123", "asset-1", "1280"))
                .thenReturn(new ResponseEntity<>(new byte[]{1, 2, 3}, upstreamHeaders, HttpStatus.OK));

        mockMvc.perform(get("/api/photos/asset-1/rendition")
                        .header("X-Auth-Token", "valid-token")
                        .param("size", "1280"))
                .andExpect(status().isOk());
    }
}
