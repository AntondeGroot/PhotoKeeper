package com.photokeeper.controller;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

/**
 * Forwards browser navigations for Angular client-side routes (e.g. /settings, /pipeline) to
 * index.html, so the Angular router can handle them. Without this, hitting such a URL directly or
 * refreshing the page returns 404, because Spring has no server-side route for it.
 *
 * <p>Every segment is matched with {@code [^\.]*}, so a path containing a dot anywhere is left
 * alone and falls through to static resource handling. Spelling the depths out is what makes that
 * true: the obvious {@code /{path:[^\.]*}/**} instead swallows everything below a dotless first
 * segment, dots included, so a nested asset like
 * {@code /celebrations/session-done/thumbs-up.webp} was forwarded to index.html and came back as
 * an HTML page with an image's content type. Root-level bundles never showed it, because their
 * first segment already contains a dot.
 *
 * <p>Three levels covers every client route the app has (the router table is empty today; the tabs
 * are in-page state). A deeper one would need another line here.
 */
@Controller
public class FrontendRoutingController {

    @GetMapping({
        "/{p1:[^\\.]*}",
        "/{p1:[^\\.]*}/{p2:[^\\.]*}",
        "/{p1:[^\\.]*}/{p2:[^\\.]*}/{p3:[^\\.]*}"
    })
    public String forwardToIndex() {
        return "forward:/index.html";
    }
}
