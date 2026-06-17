package com.photokeeper.controller;

import static org.hamcrest.Matchers.containsString;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.photokeeper.config.AdobeConfig;
import com.photokeeper.model.TokenResponse;
import com.photokeeper.service.ImsTokenService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(AuthController.class)
class AuthControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private AdobeConfig config;

    @MockitoBean
    private ImsTokenService imsTokenService;

    @Test
    void loginRedirectsToAdobeWithOfflineAccessScope() throws Exception {
        when(config.getClientId()).thenReturn("my-client-id");
        when(config.getRedirectUri()).thenReturn("http://localhost:8080/api/auth/callback");

        mockMvc.perform(get("/api/auth/login"))
                .andExpect(status().is3xxRedirection())
                .andExpect(header().string("Location", containsString("client_id=my-client-id")))
                .andExpect(header().string("Location", containsString("offline_access")));
    }

    @Test
    void callbackWithErrorRedirectsToFrontendWithError() throws Exception {
        when(config.getFrontendUrl()).thenReturn("http://localhost:4200");

        mockMvc.perform(get("/api/auth/callback").param("error", "access_denied"))
                .andExpect(status().is3xxRedirection())
                .andExpect(header().string("Location", containsString("auth_error=access_denied")));
    }

    @Test
    void callbackWithCodeRedirectsWithTokensInFragment() throws Exception {
        when(imsTokenService.exchangeCode("test-code"))
                .thenReturn(new TokenResponse("acc", "ref", 3599));
        when(config.getFrontendUrl()).thenReturn("http://localhost:4200");

        mockMvc.perform(get("/api/auth/callback").param("code", "test-code"))
                .andExpect(status().is3xxRedirection())
                .andExpect(header().string(
                        "Location", "http://localhost:4200#access_token=acc&refresh_token=ref&expires_in=3599"));
    }

    @Test
    void callbackWhenExchangeFailsRedirectsWithError() throws Exception {
        when(imsTokenService.exchangeCode(any())).thenThrow(new RuntimeException("exchange failed"));
        when(config.getFrontendUrl()).thenReturn("http://localhost:4200");

        mockMvc.perform(get("/api/auth/callback").param("code", "bad-code"))
                .andExpect(status().is3xxRedirection())
                .andExpect(header().string("Location", containsString("token_exchange_failed")));
    }

    @Test
    void refreshReturnsNewTokens() throws Exception {
        when(imsTokenService.refreshAccessToken("old-ref"))
                .thenReturn(new TokenResponse("new-acc", "new-ref", 3599));

        mockMvc.perform(post("/api/auth/refresh")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"refreshToken\":\"old-ref\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").value("new-acc"))
                .andExpect(jsonPath("$.refreshToken").value("new-ref"))
                .andExpect(jsonPath("$.expiresIn").value(3599));
    }

    @Test
    void statusWithTokenReturnsAuthenticated() throws Exception {
        mockMvc.perform(get("/api/auth/status").header("X-Auth-Token", "some-token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.authenticated").value(true));
    }

    @Test
    void statusWithoutTokenReturnsNotAuthenticated() throws Exception {
        mockMvc.perform(get("/api/auth/status"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.authenticated").value(false));
    }

    @Test
    void logoutReturnsNoContent() throws Exception {
        mockMvc.perform(delete("/api/auth/logout")).andExpect(status().isNoContent());
    }
}
