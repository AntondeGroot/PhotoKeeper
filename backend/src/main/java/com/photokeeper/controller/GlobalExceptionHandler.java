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
        // device's interceptor can refresh and retry; any other upstream failure is a 502.
        if (e.getStatusCode().value() == HttpStatus.UNAUTHORIZED.value()) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(Map.of("error", "Upstream rejected the access token"));
        }
        return ResponseEntity.status(HttpStatus.BAD_GATEWAY).body(Map.of(
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
