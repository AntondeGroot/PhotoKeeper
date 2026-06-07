package com.photokeeper.model;

public class TokenData {
    private final String accessToken;
    private String catalogId;

    public TokenData(String accessToken) {
        this.accessToken = accessToken;
    }

    public String getAccessToken() {
        return accessToken;
    }

    public String getCatalogId() {
        return catalogId;
    }

    public void setCatalogId(String catalogId) {
        this.catalogId = catalogId;
    }
}
