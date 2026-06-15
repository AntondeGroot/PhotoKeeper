package com.photokeeper.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.tuple;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.photokeeper.config.AdobeConfig;
import com.photokeeper.model.AlbumSummary;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

class LightroomServiceTest {

    private static final String IMS_TOKEN_URL = "https://ims-na1.adobelogin.com/ims/token/v3";
    private static final String LR_API_BASE = "https://lr.adobe.io/v2";

    private MockRestServiceServer server;
    private LightroomService service;

    @BeforeEach
    void setUp() {
        AdobeConfig config = new AdobeConfig();
        config.setClientId("test-api-key");
        config.setClientSecret("test-secret");
        config.setRedirectUri("http://localhost:8080/api/auth/callback");

        RestClient.Builder builder = RestClient.builder();
        server = MockRestServiceServer.bindTo(builder).build();
        service = new LightroomService(config, builder, new ObjectMapper());
    }

    @Test
    void exchangeCodePostsFormAndReturnsAccessToken() {
        server.expect(requestTo(IMS_TOKEN_URL))
                .andExpect(method(HttpMethod.POST))
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_FORM_URLENCODED))
                .andExpect(content().string(containsString("grant_type=authorization_code")))
                .andExpect(content().string(containsString("client_id=test-api-key")))
                .andExpect(content().string(containsString("code=my-code")))
                .andRespond(withSuccess("{\"access_token\":\"the-token\"}", MediaType.APPLICATION_JSON));

        assertThat(service.exchangeCode("my-code")).isEqualTo("the-token");
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
    void exchangeCodeThrowsWhenResponseEmpty() {
        server.expect(requestTo(IMS_TOKEN_URL)).andRespond(withStatus(HttpStatus.OK));

        assertThatThrownBy(() -> service.exchangeCode("any-code"))
                .isInstanceOf(LightroomApiException.class);
    }

    @Test
    void getCatalogSendsAuthHeadersAndStripsJsonHijackingPrefix() {
        server.expect(requestTo(LR_API_BASE + "/catalog"))
                .andExpect(method(HttpMethod.GET))
                .andExpect(header("Authorization", "Bearer access-1"))
                .andExpect(header("X-API-Key", "test-api-key"))
                .andRespond(withSuccess("while (1) {}\n{\"id\":\"cat-1\"}", MediaType.APPLICATION_JSON));

        Map<String, Object> result = service.getCatalog("access-1");

        assertThat(result).containsEntry("id", "cat-1");
        server.verify();
    }

    @Test
    void getAssetsBuildsCatalogUrlWithLimit() {
        server.expect(requestTo(LR_API_BASE + "/catalogs/cat-1/assets?limit=5"))
                .andExpect(method(HttpMethod.GET))
                .andRespond(withSuccess("while (1) {}{\"resources\":[]}", MediaType.APPLICATION_JSON));

        Map<String, Object> result = service.getAssets("access-1", "cat-1", 5);

        assertThat(result).containsKey("resources");
        server.verify();
    }

    @Test
    void getRenditionReturnsBinaryEntity() {
        byte[] image = {1, 2, 3, 4};
        server.expect(requestTo(LR_API_BASE + "/catalogs/cat-1/assets/asset-9/renditions/640"))
                .andExpect(method(HttpMethod.GET))
                .andExpect(header("Authorization", "Bearer access-1"))
                .andExpect(header("X-API-Key", "test-api-key"))
                .andRespond(withSuccess(image, MediaType.IMAGE_JPEG));

        ResponseEntity<byte[]> response = service.getRendition("access-1", "cat-1", "asset-9", "640");

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).containsExactly(1, 2, 3, 4);
        server.verify();
    }

    @Test
    void getAlbumsKeepsCollectionsAndDropsCollectionSets() {
        String body =
                "while (1) {}{\"resources\":["
                        + "{\"id\":\"alb-1\",\"subtype\":\"collection\",\"payload\":{\"name\":\"Lisbon, May\"}},"
                        + "{\"id\":\"set-1\",\"subtype\":\"collection_set\",\"payload\":{\"name\":\"Trips\"}},"
                        + "{\"id\":\"alb-2\",\"subtype\":\"collection\",\"payload\":{\"name\":\"Field work\"}}"
                        + "]}";
        server.expect(requestTo(LR_API_BASE + "/catalogs/cat-1/albums?subtype=collection"))
                .andExpect(method(HttpMethod.GET))
                .andExpect(header("Authorization", "Bearer access-1"))
                .andRespond(withSuccess(body, MediaType.APPLICATION_JSON));

        List<AlbumSummary> albums = service.getAlbums("access-1", "cat-1");

        assertThat(albums)
                .extracting(AlbumSummary::id, AlbumSummary::name)
                .containsExactly(tuple("alb-1", "Lisbon, May"), tuple("alb-2", "Field work"));
        server.verify();
    }

    @Test
    void getAlbumsReturnsEmptyWhenNoResources() {
        server.expect(requestTo(LR_API_BASE + "/catalogs/cat-1/albums?subtype=collection"))
                .andRespond(withSuccess("while (1) {}{\"base\":\"x\"}", MediaType.APPLICATION_JSON));

        assertThat(service.getAlbums("access-1", "cat-1")).isEmpty();
    }

    @Test
    void getAlbumAssetsUnwrapsEmbeddedAssetsAndSkipsItemsWithout() {
        String body =
                "while (1) {}{\"resources\":["
                        + "{\"id\":\"link1\",\"asset\":{\"id\":\"asset-1\",\"subtype\":\"image\"}},"
                        + "{\"id\":\"link2\"},"
                        + "42"
                        + "]}";
        server.expect(requestTo(LR_API_BASE + "/catalogs/cat-1/albums/alb-1/assets?embed=asset&limit=10"))
                .andExpect(method(HttpMethod.GET))
                .andRespond(withSuccess(body, MediaType.APPLICATION_JSON));

        List<Map<String, Object>> assets = service.getAlbumAssets("access-1", "cat-1", "alb-1", 10);

        assertThat(assets).hasSize(1);
        assertThat(assets.get(0).get("id")).isEqualTo("asset-1");
        server.verify();
    }

    @Test
    void getAlbumAssetsReturnsEmptyWhenNoResources() {
        server.expect(requestTo(LR_API_BASE + "/catalogs/cat-1/albums/alb-1/assets?embed=asset&limit=10"))
                .andRespond(withSuccess("while (1) {}{\"base\":\"x\"}", MediaType.APPLICATION_JSON));

        assertThat(service.getAlbumAssets("access-1", "cat-1", "alb-1", 10)).isEmpty();
    }

    @Test
    void getCatalogThrowsOnEmptyResponse() {
        server.expect(requestTo(LR_API_BASE + "/catalog")).andRespond(withStatus(HttpStatus.OK));

        assertThatThrownBy(() -> service.getCatalog("access-1"))
                .isInstanceOf(LightroomApiException.class)
                .hasMessageContaining("Empty response");
    }

    @Test
    void getCatalogThrowsOnMalformedJson() {
        server.expect(requestTo(LR_API_BASE + "/catalog"))
                .andRespond(withSuccess("while (1) {}not-valid-json", MediaType.APPLICATION_JSON));

        assertThatThrownBy(() -> service.getCatalog("access-1"))
                .isInstanceOf(LightroomApiException.class)
                .hasMessageContaining("Failed to parse");
    }
}
