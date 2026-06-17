package com.photokeeper.service;

import com.photokeeper.config.RateLimitConfig;
import java.io.IOException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpRequest;
import org.springframework.http.client.ClientHttpRequestExecution;
import org.springframework.http.client.ClientHttpRequestInterceptor;
import org.springframework.http.client.ClientHttpResponse;
import org.springframework.stereotype.Component;

/**
 * Paces and retries outbound Lightroom requests. Every request first passes through the global
 * {@link AdobeRateLimiter}; on a 429 it backs off (honoring {@code Retry-After}, else exponential)
 * and retries up to {@link RateLimitConfig#getMaxRetries()}, turning Adobe throttling into a short
 * wait instead of a propagated failure. Attached only to the Lightroom {@code RestClient}, so the
 * IMS token endpoint (different host, low volume) is untouched.
 */
@Component
public class LightroomRateLimitInterceptor implements ClientHttpRequestInterceptor {

    private static final Logger log = LoggerFactory.getLogger(LightroomRateLimitInterceptor.class);
    private static final int TOO_MANY_REQUESTS = 429;

    private final AdobeRateLimiter rateLimiter;
    private final Sleeper sleeper;
    private final RateLimitConfig config;

    public LightroomRateLimitInterceptor(
            AdobeRateLimiter rateLimiter, Sleeper sleeper, RateLimitConfig config) {
        this.rateLimiter = rateLimiter;
        this.sleeper = sleeper;
        this.config = config;
    }

    @Override
    public ClientHttpResponse intercept(
            HttpRequest request, byte[] body, ClientHttpRequestExecution execution)
            throws IOException {
        for (int attempt = 0; ; attempt++) {
            rateLimiter.acquire();
            ClientHttpResponse response = execution.execute(request, body);
            if (attempt >= config.getMaxRetries()
                    || response.getStatusCode().value() != TOO_MANY_REQUESTS) {
                return response;
            }
            long backoffMillis = backoffMillis(response, attempt);
            log.warn(
                    "Adobe API returned 429 (attempt {} of {}); backing off {} ms",
                    attempt + 1,
                    config.getMaxRetries(),
                    backoffMillis);
            response.close();
            sleeper.sleep(backoffMillis);
        }
    }

    /** Backoff for this attempt: the 429's {@code Retry-After} seconds if present, else exponential. */
    private long backoffMillis(ClientHttpResponse response, int attempt) throws IOException {
        String retryAfter = response.getHeaders().getFirst("Retry-After");
        if (retryAfter != null) {
            try {
                long seconds = Long.parseLong(retryAfter.trim());
                if (seconds >= 0) {
                    return Math.min(seconds * 1000L, config.getMaxBackoffMillis());
                }
            } catch (NumberFormatException e) {
                // Not a delta-seconds value (could be an HTTP-date) — fall through to exponential.
                log.debug("Non-numeric Retry-After '{}'; using exponential backoff", retryAfter);
            }
        }
        long exponential = config.getBaseBackoffMillis() << Math.min(attempt, 16);
        return Math.min(exponential, config.getMaxBackoffMillis());
    }
}
