package com.photokeeper.controller;

import static org.assertj.core.api.Assertions.assertThat;

import com.photokeeper.service.RefreshTokenRejectedException;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.server.ResponseStatusException;

class GlobalExceptionHandlerTest {

    private final GlobalExceptionHandler handler = new GlobalExceptionHandler();

    @Test
    void responseStatusExceptionUsesReasonAndStatus() {
        ResponseEntity<?> response =
                handler.handleResponseStatus(new ResponseStatusException(HttpStatus.NOT_FOUND, "asset gone"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(response.getBody()).isEqualTo(Map.of("error", "asset gone"));
    }

    @Test
    void responseStatusExceptionWithoutReasonFallsBackToClassName() {
        ResponseEntity<?> response =
                handler.handleResponseStatus(new ResponseStatusException(HttpStatus.BAD_REQUEST));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody()).isEqualTo(Map.of("error", "ResponseStatusException"));
    }

    @Test
    void rejectedRefreshTokenMapsToUnauthorisedRatherThanFailedDependency() {
        // The device only lets go of a session on a 401. Reaching it as the 424 that every other
        // upstream problem gets would leave a dead session retrying forever, never prompting.
        ResponseEntity<?> response =
                handler.handleRefreshRejected(new RefreshTokenRejectedException("spent"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(response.getBody()).isEqualTo(Map.of("error", "Refresh token rejected"));
    }

    /**
     * 424 rather than the 502 this once was. 502 describes it accurately, but the CDN in front of the
     * backend treats an origin 502 as the origin being broken and substitutes its own error page —
     * which carries no CORS headers, so the cross-origin Android app receives an opaque failure with
     * no status, indistinguishable from having no network at all.
     */
    @Test
    void upstreamErrorMapsToFailedDependencyWithDetail() {
        RestClientResponseException upstream = new RestClientResponseException(
                "failed", HttpStatus.NOT_FOUND, "Not Found", null, "boom".getBytes(StandardCharsets.UTF_8), null);

        ResponseEntity<?> response = handler.handleUpstreamError(upstream);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FAILED_DEPENDENCY);
        assertThat(response.getBody())
                .isEqualTo(Map.of("error", "Upstream API error", "status", "404 NOT_FOUND", "detail", "boom"));
    }

    @Test
    void upstream401MapsToUnauthorizedSoTheDeviceRefreshes() {
        RestClientResponseException upstream = new RestClientResponseException(
                "expired", HttpStatus.UNAUTHORIZED, "Unauthorized", null,
                "token expired".getBytes(StandardCharsets.UTF_8), null);

        ResponseEntity<?> response = handler.handleUpstreamError(upstream);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(response.getBody()).isEqualTo(Map.of("error", "Upstream rejected the access token"));
    }

    @Test
    void genericExceptionMapsToInternalServerError() {
        ResponseEntity<?> response = handler.handleGeneric(new IllegalStateException("boom"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR);
        assertThat(response.getBody())
                .isEqualTo(Map.of("error", "IllegalStateException", "message", "boom"));
    }

    @Test
    void genericExceptionWithoutMessageUsesPlaceholder() {
        ResponseEntity<?> response = handler.handleGeneric(new RuntimeException());

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR);
        assertThat(response.getBody())
                .isEqualTo(Map.of("error", "RuntimeException", "message", "(no message)"));
    }
}
