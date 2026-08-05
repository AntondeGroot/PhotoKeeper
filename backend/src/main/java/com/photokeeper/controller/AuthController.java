package com.photokeeper.controller;

import com.photokeeper.config.AdobeConfig;
import com.photokeeper.model.RefreshRequest;
import com.photokeeper.model.TokenResponse;
import com.photokeeper.service.ImsTokenService;
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

    /**
     * Marks a flow that started in the Android app rather than in a browser on the website. Sent as
     * the OAuth {@code state}, which is the one value IMS hands back to the callback unchanged, so
     * the callback can tell the two apart — the app needs its tokens delivered to a custom scheme,
     * a browser needs them delivered to the site.
     */
    private static final String APP_CLIENT = "app";

    /**
     * Where the app's tokens go. Matches the intent filter in the Android project's manifest;
     * Android launches the app for this scheme, and MainActivity turns it back into a page load.
     */
    private static final String APP_RETURN_URL = "photokeeper://auth";

    private final AdobeConfig config;
    private final ImsTokenService imsTokenService;

    public AuthController(AdobeConfig config, ImsTokenService imsTokenService) {
        this.config = config;
        this.imsTokenService = imsTokenService;
    }

    @GetMapping("/login")
    public void login(
            @RequestParam(required = false) String client,
            HttpServletResponse response) throws IOException {

        String authUrl = UriComponentsBuilder.fromUriString(ADOBE_AUTH_URL)
                .queryParam("client_id", config.getClientId())
                .queryParam("redirect_uri", config.getRedirectUri())
                .queryParam("scope", "openid,offline_access,lr_partner_apis,lr_partner_rendition_apis")
                .queryParam("response_type", "code")
                .queryParam("state", APP_CLIENT.equals(client) ? APP_CLIENT : "")
                .build().toUriString();

        log.debug("Redirecting to Adobe auth: {}", authUrl);
        response.sendRedirect(authUrl);
    }

    @GetMapping("/callback")
    public void callback(
            @RequestParam(required = false) String code,
            @RequestParam(required = false) String error,
            @RequestParam(name = "error_description", required = false) String errorDescription,
            @RequestParam(required = false) String state,
            HttpServletResponse response) throws IOException {

        // Whoever started the flow is who it has to end at. For the app that is a custom scheme
        // Android can route back to it, because by this point the user is in the system browser.
        String returnUrl = APP_CLIENT.equals(state) ? APP_RETURN_URL : config.getFrontendUrl();

        if (error != null) {
            log.error("Adobe OAuth error: {} — {}", error, errorDescription);
            response.sendRedirect(returnUrl + "?auth_error=" + error);
            return;
        }

        log.debug("Received auth callback, exchanging code for tokens");

        TokenResponse tokens;
        try {
            tokens = imsTokenService.exchangeCode(code);
        } catch (Exception e) {
            log.error("Token exchange failed: {}", e.getMessage(), e);
            response.sendRedirect(returnUrl + "?auth_error=token_exchange_failed&detail="
                    + URLEncoder.encode(String.valueOf(e.getMessage()), StandardCharsets.UTF_8));
            return;
        }

        String tokenParams = "access_token=" + enc(tokens.accessToken())
                + "&refresh_token=" + enc(tokens.refreshToken())
                + "&expires_in=" + tokens.expiresIn();

        // A browser gets them in the fragment, which is never sent to a server and stays out of
        // logs. The app cannot: Chrome drops the fragment when it launches an external app from a
        // redirect, so the tokens arrive as a query instead — which never crosses the network
        // either, since photokeeper:// is resolved locally by Android. MainActivity puts them back
        // in the fragment before handing them to the web app.
        String separator = APP_CLIENT.equals(state) ? "?" : "#";
        response.sendRedirect(returnUrl + separator + tokenParams);
    }

    @PostMapping("/refresh")
    public ResponseEntity<TokenResponse> refresh(@RequestBody RefreshRequest request) {
        return ResponseEntity.ok(imsTokenService.refreshAccessToken(request.refreshToken()));
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
