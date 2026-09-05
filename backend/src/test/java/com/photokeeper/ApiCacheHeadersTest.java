package com.photokeeper;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

/**
 * Proves {@code /api/**} responses decline the client's HTTP cache, through the real filter chain.
 *
 * <p>Not a controller slice, and that is the point: the header comes from a servlet filter, which
 * {@code @WebMvcTest} does not register. Asserted in the controller's own test it passed while the
 * filter did nothing, because the controller was still setting the header itself — the belt hid the
 * missing braces.
 *
 * <p>What it guards: every one of these responses is private to a signed-in user and already stored
 * by the app where the app can evict it. The duplicate copy in the WebView's cache had reached
 * 307 MB on a device, against 49 MB of app data, and a response with no cache directives is stored
 * anyway rather than left alone.
 */
@SpringBootTest
@AutoConfigureMockMvc
class ApiCacheHeadersTest {

    @Autowired
    private MockMvc mockMvc;

    /**
     * Any {@code /api} path will do, including one that fails: the filter runs before the handler,
     * so an unauthenticated request exercises it exactly as a successful one does — and pinning it
     * to a happy path would mean standing up Lightroom to assert a header.
     */
    @Test
    void apiResponsesAreNotStoredByTheClientCache() throws Exception {
        mockMvc.perform(get("/api/photos/asset-1/rendition"))
                .andExpect(header().string("Cache-Control", "no-store"));
    }

    @Test
    void apiResponsesCarryingDataAreNotStoredEither() throws Exception {
        mockMvc.perform(get("/api/albums")).andExpect(header().string("Cache-Control", "no-store"));
    }

    /** The app's own files are served from this origin too, and they are meant to be cached. */
    @Test
    void theAppItselfIsLeftCacheable() throws Exception {
        mockMvc.perform(get("/index.html")).andExpect(header().doesNotExist("Cache-Control"));
    }
}
