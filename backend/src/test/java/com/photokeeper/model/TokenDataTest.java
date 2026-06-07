package com.photokeeper.model;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class TokenDataTest {

    @Test
    void accessTokenIsReturnedCorrectly() {
        TokenData td = new TokenData("my-token");
        assertThat(td.getAccessToken()).isEqualTo("my-token");
    }

    @Test
    void catalogIdIsNullByDefault() {
        TokenData td = new TokenData("token");
        assertThat(td.getCatalogId()).isNull();
    }

    @Test
    void setCatalogIdUpdatesAndReturnsCatalogId() {
        TokenData td = new TokenData("token");
        td.setCatalogId("cat-123");
        assertThat(td.getCatalogId()).isEqualTo("cat-123");
    }

    @Test
    void setCatalogIdAcceptsNull() {
        TokenData td = new TokenData("token");
        td.setCatalogId("cat-123");
        td.setCatalogId(null);
        assertThat(td.getCatalogId()).isNull();
    }
}
