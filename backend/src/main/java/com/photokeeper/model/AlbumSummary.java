package com.photokeeper.model;

/** A Lightroom album reduced to the fields the frontend needs to list and tag it. */
public record AlbumSummary(String id, String name) {}
