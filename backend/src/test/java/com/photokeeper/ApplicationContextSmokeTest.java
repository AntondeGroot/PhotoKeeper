package com.photokeeper;

import static org.assertj.core.api.Assertions.assertThat;

import com.photokeeper.service.AdobeRateLimiter;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;

/**
 * Boots the full Spring context (no web server) so broken bean wiring fails the build instead of only
 * at runtime. Unit tests construct beans by hand and ArchUnit is static, so neither exercises real DI
 * — this catches things like an ambiguous constructor that stops the app from starting.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
class ApplicationContextSmokeTest {

    @Test
    void contextLoadsAndWiresBeans(ApplicationContext context) {
        assertThat(context).isNotNull();
        // Spot-check the bean whose ambiguous constructor previously broke startup.
        assertThat(context.getBean(AdobeRateLimiter.class)).isNotNull();
    }
}
