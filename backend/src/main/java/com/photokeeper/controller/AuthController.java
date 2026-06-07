package com.photokeeper.controller;

import com.photokeeper.config.AdobeConfig;
import com.photokeeper.service.LightroomService;
import com.photokeeper.service.TokenStore;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.util.UriComponentsBuilder;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private static final Logger log = LoggerFactory.getLogger(AuthController.class);
    private static final String ADOBE_AUTH_URL = "https://ims-na1.adobelogin.com/ims/authorize/v2";

    private final AdobeConfig config;
    private final LightroomService lightroomService;
    private final TokenStore tokenStore;

    public AuthController(AdobeConfig config, LightroomService lightroomService, TokenStore tokenStore) {
        this.config = config;
        this.lightroomService = lightroomService;
        this.tokenStore = tokenStore;
    }

    @GetMapping("/login")
    public void login(HttpServletResponse response) throws IOException {
        String authUrl = UriComponentsBuilder.fromUriString(ADOBE_AUTH_URL)
                .queryParam("client_id", config.getClientId())
                .queryParam("redirect_uri", config.getRedirectUri())
                .queryParam("scope", "openid,lr_partner_apis,lr_partner_rendition_apis")
                .queryParam("response_type", "code")
                .build().toUriString();

        log.debug("Redirecting to Adobe auth: {}", authUrl);
        response.sendRedirect(authUrl);
    }

    @GetMapping("/callback")
    public void callback(
            @RequestParam(required = false) String code,
            @RequestParam(required = false) String error,
            @RequestParam(name = "error_description", required = false) String errorDescription,
            HttpServletResponse response) throws IOException {

        if (error != null) {
            log.error("Adobe OAuth error: {} — {}", error, errorDescription);
            response.sendRedirect(config.getFrontendUrl() + "?auth_error=" + error);
            return;
        }

        log.debug("Received auth callback, exchanging code for token");

        String accessToken;
        try {
            accessToken = lightroomService.exchangeCode(code);
        } catch (Exception e) {
            log.error("Token exchange failed: {}", e.getMessage(), e);
            response.sendRedirect(config.getFrontendUrl() + "?auth_error=token_exchange_failed&detail="
                    + java.net.URLEncoder.encode(e.getMessage(), java.nio.charset.StandardCharsets.UTF_8));
            return;
        }

        String authKey = tokenStore.put(accessToken);

        // Eagerly fetch catalog so it's ready when the frontend calls /api/photos
        try {
            Map<String, Object> catalog = lightroomService.getCatalog(accessToken);
            String catalogId = (String) catalog.get("id");
            if (catalogId != null) {
                tokenStore.get(authKey).ifPresent(td -> td.setCatalogId(catalogId));
            }
            log.debug("Catalog fetched: {}", catalogId);
        } catch (Exception e) {
            log.warn("Could not pre-fetch catalog: {}", e.getMessage());
        }

        response.sendRedirect(config.getFrontendUrl() + "?token=" + authKey);
    }

    @GetMapping("/status")
    public ResponseEntity<Map<String, Object>> status(
            @RequestHeader(value = "X-Auth-Token", required = false) String authToken) {
        boolean authenticated = authToken != null && tokenStore.get(authToken).isPresent();
        return ResponseEntity.ok(Map.of("authenticated", authenticated));
    }

    @DeleteMapping("/logout")
    public ResponseEntity<Void> logout(
            @RequestHeader(value = "X-Auth-Token", required = false) String authToken) {
        if (authToken != null) {
            tokenStore.remove(authToken);
        }
        return ResponseEntity.noContent().build();
    }
}
