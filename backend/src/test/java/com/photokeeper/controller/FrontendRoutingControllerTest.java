package com.photokeeper.controller;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.forwardedUrl;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(FrontendRoutingController.class)
class FrontendRoutingControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void forwardsTopLevelClientRouteToIndex() throws Exception {
        mockMvc.perform(get("/settings"))
                .andExpect(status().isOk())
                .andExpect(forwardedUrl("/index.html"));
    }

    @Test
    void forwardsAnotherTopLevelClientRouteToIndex() throws Exception {
        mockMvc.perform(get("/pipeline"))
                .andExpect(status().isOk())
                .andExpect(forwardedUrl("/index.html"));
    }

    @Test
    void forwardsNestedClientRouteToIndex() throws Exception {
        mockMvc.perform(get("/review/edit"))
                .andExpect(status().isOk())
                .andExpect(forwardedUrl("/index.html"));
    }

    @Test
    void doesNotForwardPathWithFileExtension() throws Exception {
        // Paths containing a dot (main.js, styles.css, favicon.ico) must NOT be forwarded to
        // index.html — they fall through to static resource handling. Asserting that nothing was
        // forwarded proves the controller's regex did not match the dotted path. (In this test the
        // resource does not exist, so resolution ends in the GlobalExceptionHandler rather than a
        // forward; in the real deploy the bundled file is served directly.)
        mockMvc.perform(get("/main-Y5QQKEH7.js")).andExpect(forwardedUrl(null));
    }
}
