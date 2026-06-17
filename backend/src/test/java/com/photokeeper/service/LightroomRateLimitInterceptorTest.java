package com.photokeeper.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.photokeeper.config.RateLimitConfig;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.client.ClientHttpRequestExecution;
import org.springframework.http.client.ClientHttpResponse;

@SuppressWarnings("PMD.CloseResource") // ClientHttpResponse values here are Mockito mocks, not real IO
class LightroomRateLimitInterceptorTest {

    private List<Long> backoffs;
    private RateLimitConfig config;
    private LightroomRateLimitInterceptor interceptor;
    private HttpRequest request;
    private ClientHttpRequestExecution execution;

    @BeforeEach
    void setUp() {
        backoffs = new ArrayList<>();
        Sleeper noWait = millis -> {};
        Sleeper recordBackoff = backoffs::add;
        config = new RateLimitConfig();
        config.setMaxRetries(3);
        config.setBaseBackoffMillis(500);
        config.setMaxBackoffMillis(30_000);
        interceptor =
                new LightroomRateLimitInterceptor(new AdobeRateLimiter(config, noWait), recordBackoff, config);
        request = mock(HttpRequest.class);
        execution = mock(ClientHttpRequestExecution.class);
    }

    private static ClientHttpResponse response(HttpStatus status, HttpHeaders headers) throws IOException {
        ClientHttpResponse response = mock(ClientHttpResponse.class);
        when(response.getStatusCode()).thenReturn(status);
        when(response.getHeaders()).thenReturn(headers);
        return response;
    }

    @Test
    void returnsImmediatelyOnSuccessWithoutRetrying() throws IOException {
        ClientHttpResponse ok = response(HttpStatus.OK, new HttpHeaders());
        when(execution.execute(any(), any())).thenReturn(ok);

        assertThat(interceptor.intercept(request, new byte[0], execution)).isSameAs(ok);
        verify(execution, times(1)).execute(any(), any());
        assertThat(backoffs).isEmpty();
    }

    @Test
    void retriesAfter429ThenReturnsTheSuccess() throws IOException {
        ClientHttpResponse throttled = response(HttpStatus.TOO_MANY_REQUESTS, new HttpHeaders());
        ClientHttpResponse ok = response(HttpStatus.OK, new HttpHeaders());
        when(execution.execute(any(), any())).thenReturn(throttled, ok);

        assertThat(interceptor.intercept(request, new byte[0], execution)).isSameAs(ok);
        verify(execution, times(2)).execute(any(), any());
        verify(throttled).close();
        assertThat(backoffs).containsExactly(500L); // exponential base, no Retry-After header
    }

    @Test
    void honorsRetryAfterHeaderSeconds() throws IOException {
        HttpHeaders headers = new HttpHeaders();
        headers.set("Retry-After", "2");
        ClientHttpResponse throttled = response(HttpStatus.TOO_MANY_REQUESTS, headers);
        ClientHttpResponse ok = response(HttpStatus.OK, new HttpHeaders());
        when(execution.execute(any(), any())).thenReturn(throttled, ok);

        interceptor.intercept(request, new byte[0], execution);

        assertThat(backoffs).containsExactly(2000L);
    }

    @Test
    void givesUpAfterMaxRetriesAndReturnsTheLast429() throws IOException {
        ClientHttpResponse throttled = response(HttpStatus.TOO_MANY_REQUESTS, new HttpHeaders());
        when(execution.execute(any(), any())).thenReturn(throttled);

        ClientHttpResponse result = interceptor.intercept(request, new byte[0], execution);

        assertThat(result).isSameAs(throttled);
        verify(execution, times(4)).execute(any(), any()); // initial + 3 retries
        assertThat(backoffs).containsExactly(500L, 1000L, 2000L); // exponential backoff per attempt
    }
}
