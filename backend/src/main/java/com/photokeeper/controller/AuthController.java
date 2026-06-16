package com.photokeeper.controller;

import com.photokeeper.config.AdobeConfig;
import com.photokeeper.model.RefreshRequest;
import com.photokeeper.model.TokenResponse;
import com.photokeeper.service.LightroomService;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
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

    public AuthController(AdobeConfig config, LightroomService lightroomService) {
        this.config = config;
        this.lightroomService = lightroomService;
    }

    @GetMapping("/login")
    public void login(HttpServletResponse response) throws IOException {
        String authUrl = UriComponentsBuilder.fromUriString(ADOBE_AUTH_URL)
                .queryParam("client_id", config.getClientId())
                .queryParam("redirect_uri", config.getRedirectUri())
                .queryParam("scope", "openid,offline_access,lr_partner_apis,lr_partner_rendition_apis")
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

        log.debug("Received auth callback, exchanging code for tokens");

        TokenResponse tokens;
        try {
            tokens = lightroomService.exchangeCode(code);
        } catch (Exception e) {
            log.error("Token exchange failed: {}", e.getMessage(), e);
            response.sendRedirect(config.getFrontendUrl() + "?auth_error=token_exchange_failed&detail="
                    + URLEncoder.encode(String.valueOf(e.getMessage()), StandardCharsets.UTF_8));
            return;
        }

        // Hand the tokens to the device via the URL fragment (not sent to servers, kept out of logs).
        String fragment = "#access_token=" + enc(tokens.accessToken())
                + "&refresh_token=" + enc(tokens.refreshToken())
                + "&expires_in=" + tokens.expiresIn();
        response.sendRedirect(config.getFrontendUrl() + fragment);
    }

    @PostMapping("/refresh")
    public ResponseEntity<TokenResponse> refresh(@RequestBody RefreshRequest request) {
        return ResponseEntity.ok(lightroomService.refreshAccessToken(request.refreshToken()));
    }

    @GetMapping("/status")
    public ResponseEntity<Map<String, Object>> status(
            @RequestHeader(value = "X-Auth-Token", required = false) String authToken) {
        return ResponseEntity.ok(Map.of("authenticated", authToken != null && !authToken.isBlank()));
    }

    @DeleteMapping("/logout")
    public ResponseEntity<Void> logout() {
        // Tokens live on the device; logging out is a client-side clear — nothing to do server-side.
        return ResponseEntity.noContent().build();
    }

    private static String enc(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }
}
