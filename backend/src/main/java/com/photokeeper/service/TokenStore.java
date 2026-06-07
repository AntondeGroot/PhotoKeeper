package com.photokeeper.service;

import com.photokeeper.model.TokenData;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

@Component
public class TokenStore {

    private final Map<String, TokenData> store = new ConcurrentHashMap<>();

    public String put(String accessToken) {
        String key = UUID.randomUUID().toString();
        store.put(key, new TokenData(accessToken));
        return key;
    }

    public Optional<TokenData> get(String key) {
        return Optional.ofNullable(store.get(key));
    }

    public void remove(String key) {
        store.remove(key);
    }
}
