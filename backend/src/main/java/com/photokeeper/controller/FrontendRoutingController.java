package com.photokeeper.controller;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

/**
 * Forwards browser navigations for Angular client-side routes (e.g. /settings, /pipeline) to
 * index.html, so the Angular router can handle them. Without this, hitting such a URL directly or
 * refreshing the page returns 404, because Spring has no server-side route for it.
 *
 * <p>The {@code [^\.]*} pattern only matches paths without a dot, so requests for real files
 * (main.js, styles.css, favicon.ico) and /api/** routes are left untouched.
 */
@Controller
public class FrontendRoutingController {

    @GetMapping({"/{path:[^\\.]*}", "/{path:[^\\.]*}/**"})
    public String forwardToIndex() {
        return "forward:/index.html";
    }
}
