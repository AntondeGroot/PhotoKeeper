package com.photokeeper.model;

/** Body of POST /api/auth/refresh — the device's stored refresh token. */
public record RefreshRequest(String refreshToken) {}
