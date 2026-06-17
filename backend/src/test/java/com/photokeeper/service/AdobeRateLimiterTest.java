package com.photokeeper.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.photokeeper.config.RateLimitConfig;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;

class AdobeRateLimiterTest {

    private static RateLimitConfig config(int permitsPerSecond) {
        RateLimitConfig config = new RateLimitConfig();
        config.setPermitsPerSecond(permitsPerSecond);
        return config;
    }

    @Test
    void spacesBurstedRequestsByTheConfiguredInterval() {
        // 10 permits/s → 100ms interval. A fake clock that only advances when the sleeper "sleeps",
        // so calling acquire() back-to-back must sleep ~100ms each time after the first.
        AtomicLong clockNanos = new AtomicLong(0);
        List<Long> sleeps = new ArrayList<>();
        Sleeper sleeper = millis -> {
            sleeps.add(millis);
            clockNanos.addAndGet(millis * 1_000_000L);
        };
        AdobeRateLimiter limiter = new AdobeRateLimiter(config(10), sleeper, clockNanos::get);

        limiter.acquire();
        limiter.acquire();
        limiter.acquire();

        assertThat(sleeps).containsExactly(100L, 100L); // first slot is free, the next two wait
    }

    @Test
    void doesNotSleepWhenCallsAreAlreadySpacedOut() {
        AtomicLong clockNanos = new AtomicLong(0);
        List<Long> sleeps = new ArrayList<>();
        Sleeper sleeper = sleeps::add;
        AdobeRateLimiter limiter = new AdobeRateLimiter(config(10), sleeper, clockNanos::get);

        limiter.acquire();
        clockNanos.addAndGet(200_000_000L); // 200ms pass before the next call (> the 100ms interval)
        limiter.acquire();

        assertThat(sleeps).isEmpty();
    }
}
