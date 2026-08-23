package com.photokeeper.config;

import jakarta.annotation.Nullable;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.LinkedHashSet;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Which origins may call {@code /api/**}.
 *
 * <p>The deployed origin has to be listed even though the app is served from it. Browsers omit
 * {@code Origin} on a same-origin GET but send it on a same-origin POST, and Spring runs CORS on any
 * request carrying the header — so listing only the dev server let every GET through and had Spring
 * reject every POST with a 403 before the controller saw it. The one POST on the critical path is
 * {@code /api/auth/refresh}, so token refresh could never succeed in production: each time the
 * access token expired the device read the 403 as Adobe refusing it and dropped the session.
 */
@Configuration
public class CorsConfig implements WebMvcConfigurer {

    private static final Logger log = LoggerFactory.getLogger(CorsConfig.class);

    /** Where {@code ng serve} runs (see frontend/angular.json) — genuinely cross-origin in dev. */
    private static final String DEV_ORIGIN = "http://localhost:6200";

    private final String frontendUrl;

    /**
     * Takes the property rather than {@link AdobeConfig}, so that CORS — which every web slice pulls
     * in as a {@code WebMvcConfigurer} — does not drag a configuration bean into each one. Defaults
     * to empty, which simply leaves the dev origin standing.
     */
    public CorsConfig(@Value("${adobe.frontend-url:}") String frontendUrl) {
        this.frontendUrl = frontendUrl;
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        String[] origins = allowedOrigins().toArray(new String[0]);
        log.info("CORS: allowing origins {}", String.join(", ", origins));
        registry.addMapping("/api/**")
                .allowedOrigins(origins)
                .allowedMethods("GET", "POST", "DELETE", "OPTIONS")
                .allowedHeaders("*")
                .allowCredentials(false);
    }

    /**
     * The dev server, plus wherever this deployment serves the app from.
     *
     * <p>Taken from {@code adobe.frontend-url} rather than listed separately: that is already the
     * one place each environment says where its frontend lives, and a second list to keep in step
     * is a second list to forget. A set, because in dev the two are the same value.
     */
    private Set<String> allowedOrigins() {
        Set<String> origins = new LinkedHashSet<>();
        origins.add(DEV_ORIGIN);
        String frontendOrigin = originOf(frontendUrl);
        if (frontendOrigin != null) {
            origins.add(frontendOrigin);
        }
        return origins;
    }

    /**
     * The scheme, host and port of a URL — the exact form a browser puts in {@code Origin}, with any
     * path dropped. {@code https://example.test/photokeeper} is served to the browser as an origin of
     * {@code https://example.test}, and matching is byte-for-byte, so the path has to go.
     */
    @Nullable
    private static String originOf(@Nullable String url) {
        if (url == null || url.isBlank()) {
            return null;
        }
        try {
            URI uri = new URI(url);
            if (uri.getScheme() == null || uri.getHost() == null) {
                return null;
            }
            String port = uri.getPort() == -1 ? "" : ":" + uri.getPort();
            return uri.getScheme() + "://" + uri.getHost() + port;
        } catch (URISyntaxException e) {
            log.warn("adobe.frontend-url is not a URL, so its origin cannot be allowed: {}", url);
            return null;
        }
    }
}
