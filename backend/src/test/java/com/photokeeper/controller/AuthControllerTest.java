package com.photokeeper.controller;

import static org.hamcrest.Matchers.containsString;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.photokeeper.config.AdobeConfig;
import com.photokeeper.model.TokenData;
import com.photokeeper.service.LightroomService;
import com.photokeeper.service.TokenStore;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(AuthController.class)
class AuthControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private AdobeConfig config;

    @MockitoBean
    private LightroomService lightroomService;

    @MockitoBean
    private TokenStore tokenStore;

    @Test
    void loginRedirectsToAdobeAuthUrl() throws Exception {
        when(config.getClientId()).thenReturn("my-client-id");
        when(config.getRedirectUri()).thenReturn("http://localhost:8080/api/auth/callback");

        mockMvc.perform(get("/api/auth/login"))
                .andExpect(status().is3xxRedirection())
                .andExpect(header().string("Location", containsString("client_id=my-client-id")));
    }

    @Test
    void callbackWithErrorRedirectsToFrontendWithError() throws Exception {
        when(config.getFrontendUrl()).thenReturn("http://localhost:4200");

        mockMvc.perform(get("/api/auth/callback").param("error", "access_denied"))
                .andExpect(status().is3xxRedirection())
                .andExpect(header().string("Location", containsString("auth_error=access_denied")));
    }

    @Test
    void callbackWithCodeExchangesAndRedirects() throws Exception {
        when(lightroomService.exchangeCode("test-code")).thenReturn("access-token");
        when(tokenStore.put("access-token")).thenReturn("auth-key");
        when(lightroomService.getCatalog("access-token")).thenReturn(Map.of("id", "cat-123"));
        when(tokenStore.get("auth-key")).thenReturn(Optional.of(new TokenData("access-token")));
        when(config.getFrontendUrl()).thenReturn("http://localhost:4200");

        mockMvc.perform(get("/api/auth/callback").param("code", "test-code"))
                .andExpect(status().is3xxRedirection())
                .andExpect(header().string("Location", "http://localhost:4200?token=auth-key"));
    }

    @Test
    void callbackWhenExchangeFailsRedirectsWithError() throws Exception {
        when(lightroomService.exchangeCode(any())).thenThrow(new RuntimeException("exchange failed"));
        when(config.getFrontendUrl()).thenReturn("http://localhost:4200");

        mockMvc.perform(get("/api/auth/callback").param("code", "bad-code"))
                .andExpect(status().is3xxRedirection())
                .andExpect(header().string("Location", containsString("token_exchange_failed")));
    }

    @Test
    void statusWithValidTokenReturnsAuthenticated() throws Exception {
        when(tokenStore.get("valid-key")).thenReturn(Optional.of(new TokenData("token")));

        mockMvc.perform(get("/api/auth/status").header("X-Auth-Token", "valid-key"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.authenticated").value(true));
    }

    @Test
    void statusWithNoTokenReturnsNotAuthenticated() throws Exception {
        mockMvc.perform(get("/api/auth/status"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.authenticated").value(false));
    }

    @Test
    void statusWithUnknownTokenReturnsNotAuthenticated() throws Exception {
        when(tokenStore.get("unknown-key")).thenReturn(Optional.empty());

        mockMvc.perform(get("/api/auth/status").header("X-Auth-Token", "unknown-key"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.authenticated").value(false));
    }

    @Test
    void logoutWithValidTokenRemovesAndReturnsNoContent() throws Exception {
        mockMvc.perform(delete("/api/auth/logout").header("X-Auth-Token", "some-key"))
                .andExpect(status().isNoContent());

        verify(tokenStore).remove("some-key");
    }

    @Test
    void logoutWithNoTokenReturnsNoContent() throws Exception {
        mockMvc.perform(delete("/api/auth/logout"))
                .andExpect(status().isNoContent());
    }

    @Test
    void callbackWhenCatalogMissingIdSetsNoCatalogId() throws Exception {
        when(lightroomService.exchangeCode("test-code")).thenReturn("access-token");
        when(tokenStore.put("access-token")).thenReturn("auth-key");
        when(lightroomService.getCatalog("access-token")).thenReturn(Map.of("name", "My Catalog"));
        when(tokenStore.get("auth-key")).thenReturn(Optional.of(new TokenData("access-token")));
        when(config.getFrontendUrl()).thenReturn("http://localhost:4200");

        mockMvc.perform(get("/api/auth/callback").param("code", "test-code"))
                .andExpect(status().is3xxRedirection())
                .andExpect(header().string("Location", "http://localhost:4200?token=auth-key"));
    }

    @Test
    void callbackCatalogFetchFailsContinuesToRedirect() throws Exception {
        when(lightroomService.exchangeCode("test-code")).thenReturn("access-token");
        when(tokenStore.put("access-token")).thenReturn("auth-key");
        when(lightroomService.getCatalog("access-token")).thenThrow(new RuntimeException("catalog error"));
        when(config.getFrontendUrl()).thenReturn("http://localhost:4200");

        mockMvc.perform(get("/api/auth/callback").param("code", "test-code"))
                .andExpect(status().is3xxRedirection())
                .andExpect(header().string("Location", "http://localhost:4200?token=auth-key"));
    }
}
