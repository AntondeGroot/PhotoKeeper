package com.photokeeper.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Tunables for throttling outbound Adobe Lightroom API calls and retrying 429s. Adobe limits each
 * client id to ~20 requests/second (shared across all of this app's users), so we pace well under
 * that and back off politely when throttled. All fields have safe defaults; override via
 * {@code adobe.rate-limit.*} properties.
 */
@ConfigurationProperties(prefix = "adobe.rate-limit")
public class RateLimitConfig {

    /** Outbound request ceiling, kept comfortably under Adobe's 20-RPS-per-client-id limit. */
    private int permitsPerSecond = 10;

    /** How many times to retry a 429 before surfacing the failure. */
    private int maxRetries = 3;

    /** First backoff step when the 429 carries no Retry-After; doubles each attempt. */
    private long baseBackoffMillis = 500;

    /** Hard cap on any single backoff wait, so a huge Retry-After can't stall us indefinitely. */
    private long maxBackoffMillis = 30_000;

    public int getPermitsPerSecond() {
        return permitsPerSecond;
    }

    public void setPermitsPerSecond(int permitsPerSecond) {
        this.permitsPerSecond = permitsPerSecond;
    }

    public int getMaxRetries() {
        return maxRetries;
    }

    public void setMaxRetries(int maxRetries) {
        this.maxRetries = maxRetries;
    }

    public long getBaseBackoffMillis() {
        return baseBackoffMillis;
    }

    public void setBaseBackoffMillis(long baseBackoffMillis) {
        this.baseBackoffMillis = baseBackoffMillis;
    }

    public long getMaxBackoffMillis() {
        return maxBackoffMillis;
    }

    public void setMaxBackoffMillis(long maxBackoffMillis) {
        this.maxBackoffMillis = maxBackoffMillis;
    }
}
