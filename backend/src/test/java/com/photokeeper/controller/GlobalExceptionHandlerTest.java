package com.photokeeper.controller;

import static org.assertj.core.api.Assertions.assertThat;

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
    void upstreamErrorMapsToBadGatewayWithDetail() {
        RestClientResponseException upstream = new RestClientResponseException(
                "failed", HttpStatus.NOT_FOUND, "Not Found", null, "boom".getBytes(StandardCharsets.UTF_8), null);

        ResponseEntity<?> response = handler.handleUpstreamError(upstream);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_GATEWAY);
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
