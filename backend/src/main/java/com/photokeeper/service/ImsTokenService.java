package com.photokeeper.service;

import com.photokeeper.config.AdobeConfig;
import com.photokeeper.model.TokenResponse;
import java.util.Map;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;

/**
 * Talks to Adobe's IMS OAuth endpoint to obtain and refresh access tokens. Kept separate from
 * {@link LightroomService} (which calls the Lightroom data API at a different host) so each service
 * owns one concern.
 */
@Service
public class ImsTokenService {

    private static final String IMS_TOKEN_URL = "https://ims-na1.adobelogin.com/ims/token/v3";

    private static final ParameterizedTypeReference<Map<String, Object>> MAP_TYPE =
            new ParameterizedTypeReference<>() {};

    private final AdobeConfig config;
    private final RestClient restClient;

    public ImsTokenService(AdobeConfig config, RestClient.Builder restClientBuilder) {
        this.config = config;
        this.restClient = restClientBuilder.build();
    }

    /** Exchanges an authorization code for the access + refresh token set (offline_access scope). */
    public TokenResponse exchangeCode(String code) {
        MultiValueMap<String, String> body = new LinkedMultiValueMap<>();
        body.add("grant_type", "authorization_code");
        body.add("client_id", config.getClientId());
        body.add("client_secret", config.getClientSecret());
        body.add("redirect_uri", config.getRedirectUri());
        body.add("code", code);

        Map<String, Object> response = postToken(body);
        String accessToken = accessTokenOf(response);
        if (!(response.get("refresh_token") instanceof String refreshToken)) {
            throw new LightroomApiException("Token exchange failed: no refresh_token in response");
        }
        return new TokenResponse(accessToken, refreshToken, expiresInOf(response));
    }

    /**
     * Exchanges a refresh token for a fresh access token. Adobe may rotate the refresh token; if it
     * doesn't return a new one, the caller's existing refresh token is carried over.
     *
     * A 4xx from IMS is Adobe judging the token and finding it wanting, and is reported as such —
     * everything else (IMS down, a timeout, a connection reset) is left to surface as the transient
     * failure it is, because the device decides whether to keep its credentials on that distinction.
     */
    public TokenResponse refreshAccessToken(String refreshToken) {
        MultiValueMap<String, String> body = new LinkedMultiValueMap<>();
        body.add("grant_type", "refresh_token");
        body.add("client_id", config.getClientId());
        body.add("client_secret", config.getClientSecret());
        body.add("refresh_token", refreshToken);

        Map<String, Object> response;
        try {
            response = postToken(body);
        } catch (HttpClientErrorException e) {
            throw new RefreshTokenRejectedException(
                    "Adobe rejected the refresh token: " + e.getResponseBodyAsString(), e);
        }
        if (!(response.get("access_token") instanceof String accessToken)) {
            // A 200 carrying `{"error":"invalid_grant"}` is the same verdict as a 4xx, differently
            // dressed. IMS answers both ways, and either means this token is spent for good.
            throw new RefreshTokenRejectedException("Adobe returned no access token for the refresh");
        }
        String newRefresh =
                response.get("refresh_token") instanceof String s ? s : refreshToken;
        return new TokenResponse(accessToken, newRefresh, expiresInOf(response));
    }

    private Map<String, Object> postToken(MultiValueMap<String, String> body) {
        Map<String, Object> response = restClient.post()
                .uri(IMS_TOKEN_URL)
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .body(body)
                .retrieve()
                .body(MAP_TYPE);
        if (response == null) {
            throw new LightroomApiException("Adobe token endpoint returned an empty response");
        }
        return response;
    }

    private static String accessTokenOf(Map<String, Object> response) {
        if (!(response.get("access_token") instanceof String accessToken)) {
            throw new LightroomApiException("Token response has no access_token");
        }
        return accessToken;
    }

    private static long expiresInOf(Map<String, Object> response) {
        return response.get("expires_in") instanceof Number n ? n.longValue() : 0L;
    }
}
