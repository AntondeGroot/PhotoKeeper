package com.photokeeper.model;

import jakarta.annotation.Nullable;

public class TokenData {
    private final String accessToken;
    @Nullable private String catalogId;

    public TokenData(String accessToken) {
        this.accessToken = accessToken;
    }

    public String getAccessToken() {
        return accessToken;
    }

    @Nullable public String getCatalogId() {
        return catalogId;
    }

    public void setCatalogId(@Nullable String catalogId) {
        this.catalogId = catalogId;
    }
}
