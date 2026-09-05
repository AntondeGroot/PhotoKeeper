package com.photokeeper.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Keeps {@code /api/**} out of the client's HTTP cache.
 *
 * <p>Every one of these responses is private to one signed-in user and already cached by the app
 * where the app can manage it: renditions and metadata go into its own device-local store, with its
 * own eviction. A second copy in the WebView's HTTP cache is duplication that nothing reads, nothing
 * evicts and nothing was even aware of — measured on a device it had grown to 307 MB of cache
 * against 49 MB of app data, six times the size of the thing it was shadowing.
 *
 * <p>Declining has to be explicit. A response carrying no cache directives is not left alone: the
 * cache stores it anyway and revalidates it later, so silence reads as consent.
 *
 * <p>A filter rather than a header per endpoint, so that an endpoint added later is covered by
 * having been written at all, rather than by someone remembering.
 */
@Configuration
public class ApiCacheConfig {

    /** Matches the CORS mapping: {@code /api/**} is the whole of what this server answers. */
    private static final String API_PATHS = "/api/*";

    @Bean
    public FilterRegistrationBean<OncePerRequestFilter> noStoreApiResponses() {
        FilterRegistrationBean<OncePerRequestFilter> registration = new FilterRegistrationBean<>();
        registration.setFilter(new NoStoreFilter());
        registration.addUrlPatterns(API_PATHS);
        registration.setName("noStoreApiResponses");
        return registration;
    }

    /** Sets {@code Cache-Control: no-store} on the way out, leaving the response otherwise alone. */
    private static final class NoStoreFilter extends OncePerRequestFilter {

        @Override
        protected void doFilterInternal(
                HttpServletRequest request, HttpServletResponse response, FilterChain chain)
                throws ServletException, IOException {
            // Set before the chain runs: headers cannot be added once the body has begun, and a
            // rendition is written straight to the stream.
            response.setHeader(HttpHeaders.CACHE_CONTROL, CacheControl.noStore().getHeaderValue());
            chain.doFilter(request, response);
        }
    }
}
