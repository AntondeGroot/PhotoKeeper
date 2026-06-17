package com.photokeeper.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import com.photokeeper.config.AdobeConfig;
import com.photokeeper.model.TokenResponse;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

class ImsTokenServiceTest {

    private static final String IMS_TOKEN_URL = "https://ims-na1.adobelogin.com/ims/token/v3";

    private MockRestServiceServer server;
    private ImsTokenService service;

    @BeforeEach
    void setUp() {
        AdobeConfig config = new AdobeConfig();
        config.setClientId("test-api-key");
        config.setClientSecret("test-secret");
        config.setRedirectUri("http://localhost:8080/api/auth/callback");

        RestClient.Builder builder = RestClient.builder();
        server = MockRestServiceServer.bindTo(builder).build();
        service = new ImsTokenService(config, builder);
    }

    @Test
    void exchangeCodePostsFormAndReturnsTokenSet() {
        server.expect(requestTo(IMS_TOKEN_URL))
                .andExpect(method(HttpMethod.POST))
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_FORM_URLENCODED))
                .andExpect(content().string(containsString("grant_type=authorization_code")))
                .andExpect(content().string(containsString("client_id=test-api-key")))
                .andExpect(content().string(containsString("code=my-code")))
                .andRespond(withSuccess(
                        "{\"access_token\":\"acc\",\"refresh_token\":\"ref\",\"expires_in\":3599}",
                        MediaType.APPLICATION_JSON));

        TokenResponse tokens = service.exchangeCode("my-code");

        assertThat(tokens.accessToken()).isEqualTo("acc");
        assertThat(tokens.refreshToken()).isEqualTo("ref");
        assertThat(tokens.expiresIn()).isEqualTo(3599L);
        server.verify();
    }

    @Test
    void exchangeCodeThrowsWhenAccessTokenMissing() {
        server.expect(requestTo(IMS_TOKEN_URL))
                .andRespond(withSuccess("{\"error\":\"invalid_grant\"}", MediaType.APPLICATION_JSON));

        assertThatThrownBy(() -> service.exchangeCode("bad-code"))
                .isInstanceOf(LightroomApiException.class)
                .hasMessageContaining("no access_token");
    }

    @Test
    void exchangeCodeThrowsWhenRefreshTokenMissing() {
        server.expect(requestTo(IMS_TOKEN_URL))
                .andRespond(withSuccess("{\"access_token\":\"acc\"}", MediaType.APPLICATION_JSON));

        assertThatThrownBy(() -> service.exchangeCode("code"))
                .isInstanceOf(LightroomApiException.class)
                .hasMessageContaining("no refresh_token");
    }

    @Test
    void exchangeCodeThrowsWhenResponseEmpty() {
        server.expect(requestTo(IMS_TOKEN_URL)).andRespond(withStatus(HttpStatus.OK));

        assertThatThrownBy(() -> service.exchangeCode("any-code"))
                .isInstanceOf(LightroomApiException.class);
    }

    @Test
    void refreshAccessTokenPostsRefreshGrantAndReturnsNewTokens() {
        server.expect(requestTo(IMS_TOKEN_URL))
                .andExpect(method(HttpMethod.POST))
                .andExpect(content().string(containsString("grant_type=refresh_token")))
                .andExpect(content().string(containsString("refresh_token=old-ref")))
                .andRespond(withSuccess(
                        "{\"access_token\":\"new-acc\",\"refresh_token\":\"new-ref\",\"expires_in\":3599}",
                        MediaType.APPLICATION_JSON));

        TokenResponse tokens = service.refreshAccessToken("old-ref");

        assertThat(tokens.accessToken()).isEqualTo("new-acc");
        assertThat(tokens.refreshToken()).isEqualTo("new-ref");
        server.verify();
    }

    @Test
    void refreshAccessTokenCarriesOverRefreshTokenWhenNotRotated() {
        server.expect(requestTo(IMS_TOKEN_URL))
                .andRespond(withSuccess("{\"access_token\":\"new-acc\"}", MediaType.APPLICATION_JSON));

        TokenResponse tokens = service.refreshAccessToken("old-ref");

        assertThat(tokens.accessToken()).isEqualTo("new-acc");
        assertThat(tokens.refreshToken()).isEqualTo("old-ref"); // reused — Adobe didn't rotate
    }
}
