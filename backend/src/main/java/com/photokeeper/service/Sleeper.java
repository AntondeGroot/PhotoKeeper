package com.photokeeper.service;

/**
 * Indirection over {@link Thread#sleep} so the rate limiter and backoff logic are unit-testable
 * without real waits — tests inject a no-op or recording sleeper.
 */
@FunctionalInterface
public interface Sleeper {
    void sleep(long millis);
}
