package com.photokeeper.controller;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

/** Serves the APK download page at /download without requiring a .html extension. */
@Controller
public class DownloadController {

    @GetMapping("/download")
    public String downloadPage() {
        return "forward:/download.html";
    }
}
