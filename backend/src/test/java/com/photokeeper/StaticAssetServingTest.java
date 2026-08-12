package com.photokeeper;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

/**
 * Proves a nested static asset is actually <em>served</em>, through the whole chain: routing does not
 * intercept it, the resource handler finds it, and it comes back with an image content type.
 *
 * <p>{@code FrontendRoutingControllerTest} only asserts the controller declines the path. That is a
 * slice with no static resources, so it cannot tell "falls through and is served" from "falls through
 * and 404s" — and the bug this guards against produced a perfectly cheerful <b>200</b>: the SPA
 * fallback returned index.html for every celebration image, so the browser got HTML where it wanted
 * webp and rendered nothing at all. Status alone would not have caught it; the content type is the
 * assertion that matters.
 *
 * <p>The fixture under {@code src/test/resources/static/} stands in for the exported artwork, which
 * is produced outside the build and is not on the test classpath.
 */
@SpringBootTest
@AutoConfigureMockMvc
class StaticAssetServingTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void servesANestedImageAsAnImage() throws Exception {
        mockMvc.perform(get("/celebrations/session-done/probe.webp"))
                .andExpect(status().isOk())
                .andExpect(content().contentType(MediaType.valueOf("image/webp")))
                .andExpect(header().string("Content-Length", "56"));
    }

    @Test
    void stillForwardsAClientRouteToIndex() throws Exception {
        // The other half of the bargain: tightening the routing regex must not stop real client
        // navigations reaching the Angular app.
        mockMvc.perform(get("/settings")).andExpect(status().isOk());
    }
}
