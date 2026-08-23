package com.photokeeper.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.photokeeper.controller.AuthController;
import com.photokeeper.service.ImsTokenService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * The deployed app is served from the same origin as the API, which is exactly why this was easy to
 * get wrong: browsers omit {@code Origin} on a same-origin GET but send it on a same-origin POST,
 * and Spring CORS-checks anything carrying the header. Listing only the dev server therefore let
 * every GET through and rejected every POST with a 403 — invisible until a token needed refreshing,
 * and then read by the device as Adobe refusing the session.
 */
// Set as a property rather than a stubbed bean: CORS is configured once at startup, so the value
// has to be in place before the context builds — and this exercises the real binding besides. The
// URL carries a path, as the deployed one does; the origin is only the scheme and host.
@WebMvcTest(AuthController.class)
@TestPropertySource(properties = "adobe.frontend-url=https://photos.test/photokeeper")
class CorsConfigTest {

    private static final String DEPLOYED_ORIGIN = "https://photos.test";
    private static final String REFRESH_BODY = "{\"refreshToken\":\"any\"}";

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private ImsTokenService imsTokenService;

    // AuthController's own dependency; CORS reads the property directly and does not need it.
    @MockitoBean
    private AdobeConfig adobeConfig;

    private MockHttpServletRequestBuilder refreshFrom(String origin) {
        return post("/api/auth/refresh")
                .header("Origin", origin)
                .contentType(MediaType.APPLICATION_JSON)
                .content(REFRESH_BODY);
    }

    @Test
    void aPostFromTheDeployedOriginReachesTheController() throws Exception {
        int status = mockMvc.perform(refreshFrom(DEPLOYED_ORIGIN)).andReturn().getResponse().getStatus();

        // Whatever Adobe then makes of the token, the request must not die in the CORS filter.
        assertThat(status).isNotEqualTo(403);
    }

    @Test
    void aPostFromTheDevServerStillReachesTheController() throws Exception {
        int status =
                mockMvc.perform(refreshFrom("http://localhost:6200")).andReturn().getResponse().getStatus();

        assertThat(status).isNotEqualTo(403);
    }

    @Test
    void aPostFromSomewhereElseIsStillRefused() throws Exception {
        int status =
                mockMvc.perform(refreshFrom("https://not-our-site.test")).andReturn().getResponse().getStatus();

        assertThat(status).isEqualTo(403);
    }
}
