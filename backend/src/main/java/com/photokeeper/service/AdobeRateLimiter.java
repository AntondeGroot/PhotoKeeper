package com.photokeeper.service;

import com.photokeeper.config.RateLimitConfig;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.LongSupplier;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * Global serial pacer for outbound Adobe Lightroom calls. Spaces requests at least
 * {@code 1 / permitsPerSecond} apart so a bulk background scan stays well under Adobe's
 * 20-RPS-per-client-id ceiling. {@link #acquire()} blocks the caller until its slot is due.
 *
 * <p>This is the single global guardian — every Lightroom request acquires here first. Priority
 * (interactive over background) and per-user fairness are future refinements; today it is a fair,
 * first-come serial gate.
 */
@Component
public class AdobeRateLimiter {

    private final long intervalNanos;
    private final Sleeper sleeper;
    private final LongSupplier nanoTime;
    private final ReentrantLock lock = new ReentrantLock();
    private long nextFreeNanos;

    // @Autowired marks this as the constructor Spring uses; the 3-arg one is for tests (injectable
    // clock), and without this Spring can't choose between the two and fails to instantiate the bean.
    @Autowired
    public AdobeRateLimiter(RateLimitConfig config, Sleeper sleeper) {
        this(config, sleeper, System::nanoTime);
    }

    /* default */ AdobeRateLimiter(RateLimitConfig config, Sleeper sleeper, LongSupplier nanoTime) {
        this.intervalNanos = 1_000_000_000L / Math.max(1, config.getPermitsPerSecond());
        this.sleeper = sleeper;
        this.nanoTime = nanoTime;
        this.nextFreeNanos = nanoTime.getAsLong();
    }

    /** Blocks until the next request slot is due, then reserves it. */
    public void acquire() {
        lock.lock();
        try {
            long now = nanoTime.getAsLong();
            long waitNanos = nextFreeNanos - now;
            if (waitNanos > 0) {
                sleeper.sleep((waitNanos + 999_999L) / 1_000_000L); // ceil nanos → millis
            }
            this.nextFreeNanos = Math.max(now, nextFreeNanos) + intervalNanos;
        } finally {
            lock.unlock();
        }
    }
}
