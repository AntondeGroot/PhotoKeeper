package com.photokeeper.controller;

import com.photokeeper.service.RefreshTokenRejectedException;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MissingRequestHeaderException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.server.ResponseStatusException;

@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(MissingRequestHeaderException.class)
    public ResponseEntity<Map<String, String>> handleMissingHeader(MissingRequestHeaderException e) {
        // The only required header is the auth token, so a missing one means "not authenticated".
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Missing " + e.getHeaderName()));
    }

    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<Map<String, String>> handleResponseStatus(ResponseStatusException e) {
        String reason = e.getReason() != null ? e.getReason() : e.getClass().getSimpleName();
        return ResponseEntity.status(e.getStatusCode()).body(Map.of("error", reason));
    }

    @ExceptionHandler(RefreshTokenRejectedException.class)
    public ResponseEntity<Map<String, String>> handleRefreshRejected(RefreshTokenRejectedException e) {
        log.info("Refresh token rejected by Adobe: {}", e.getMessage());
        // 401 and nothing else. The device treats a refresh failure as final only when it arrives
        // as an auth failure, so mapping this to the 502 that every other upstream problem gets
        // would leave a genuinely dead session retrying forever with no prompt to sign in again.
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Refresh token rejected"));
    }

    @ExceptionHandler(RestClientResponseException.class)
    public ResponseEntity<Map<String, String>> handleUpstreamError(RestClientResponseException e) {
        log.error("Upstream API error {}: {}", e.getStatusCode(), e.getResponseBodyAsString());
        // An upstream 401 means the access token expired/was revoked. Surface it as a 401 so the
        // device's interceptor can refresh and retry.
        if (e.getStatusCode().value() == HttpStatus.UNAUTHORIZED.value()) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(Map.of("error", "Upstream rejected the access token"));
        }
        // 424, not 502, and the difference is the whole reason this comment exists.
        //
        // 502 is the honest description — this *is* a gateway whose upstream failed — but the CDN in
        // front of it reads an origin 502 as the origin being broken and replaces the response with
        // its own error page. That page carries no CORS headers, so to the Android app, which is
        // cross-origin, the whole thing arrives as an opaque "Failed to fetch" with no status at all:
        // indistinguishable from having no network, and reported to the user as being offline.
        //
        // FAILED_DEPENDENCY says the same thing about a request that depended on another service, and
        // is passed through untouched. See CorsConfig for the other half of why the app can read it.
        return ResponseEntity.status(HttpStatus.FAILED_DEPENDENCY).body(Map.of(
                "error", "Upstream API error",
                "status", e.getStatusCode().toString(),
                "detail", e.getResponseBodyAsString()
        ));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, String>> handleGeneric(Exception e) {
        log.error("Unexpected error", e);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of(
                "error", e.getClass().getSimpleName(),
                "message", e.getMessage() != null ? e.getMessage() : "(no message)"
        ));
    }
}
