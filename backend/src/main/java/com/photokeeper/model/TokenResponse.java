package com.photokeeper.model;

/** Adobe IMS token set returned to the device: short-lived access token + long-lived refresh token. */
public record TokenResponse(String accessToken, String refreshToken, long expiresIn) {}
