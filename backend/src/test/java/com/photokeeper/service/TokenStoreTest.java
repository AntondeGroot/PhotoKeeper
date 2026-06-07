package com.photokeeper.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.photokeeper.model.TokenData;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class TokenStoreTest {

    private final TokenStore store = new TokenStore();

    @Test
    void putStoresTokenAndReturnsUniqueKey() {
        String key1 = store.put("token-a");
        String key2 = store.put("token-b");
        assertThat(key1).isNotBlank();
        assertThat(key2).isNotBlank();
        assertThat(key1).isNotEqualTo(key2);
    }

    @Test
    void getExistingKeyReturnsTokenData() {
        String key = store.put("my-access-token");
        Optional<TokenData> result = store.get(key);
        assertThat(result).isPresent();
        assertThat(result.orElseThrow().getAccessToken()).isEqualTo("my-access-token");
    }

    @Test
    void getUnknownKeyReturnsEmpty() {
        assertThat(store.get("no-such-key")).isEmpty();
    }

    @Test
    void removeExistingKeyDeletesEntry() {
        String key = store.put("token-to-remove");
        store.remove(key);
        assertThat(store.get(key)).isEmpty();
    }
}
