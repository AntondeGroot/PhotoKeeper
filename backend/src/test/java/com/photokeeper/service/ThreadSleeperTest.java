package com.photokeeper.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

@SuppressWarnings("PMD.DoNotUseThreads") // exercising interrupt handling needs direct Thread calls
class ThreadSleeperTest {

    private final ThreadSleeper sleeper = new ThreadSleeper();

    @Test
    void returnsImmediatelyForNonPositiveDurations() {
        long before = System.nanoTime();
        sleeper.sleep(0);
        sleeper.sleep(-5);
        assertThat(System.nanoTime() - before).isLessThan(50_000_000L); // well under 50ms
    }

    @Test
    void sleepsForPositiveDurations() {
        long before = System.nanoTime();
        sleeper.sleep(20);
        assertThat(System.nanoTime() - before).isGreaterThanOrEqualTo(15_000_000L);
    }

    @Test
    void restoresInterruptFlagAndThrowsWhenInterrupted() {
        Thread.currentThread().interrupt();
        assertThatThrownBy(() -> sleeper.sleep(10_000))
                .isInstanceOf(LightroomApiException.class)
                .hasMessageContaining("Interrupted");
        assertThat(Thread.interrupted()).isTrue(); // flag was restored (and is now cleared)
    }
}
