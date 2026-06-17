package com.photokeeper.service;

import org.springframework.stereotype.Component;

/** Production {@link Sleeper}: a real {@link Thread#sleep} that restores the interrupt flag. */
@Component
@SuppressWarnings("PMD.DoNotUseThreads") // pacing genuinely requires sleeping the calling thread
public class ThreadSleeper implements Sleeper {

    @Override
    public void sleep(long millis) {
        if (millis <= 0) {
            return;
        }
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new LightroomApiException("Interrupted while throttling Adobe API requests", e);
        }
    }
}
