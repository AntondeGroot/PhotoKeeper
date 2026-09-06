package com.photokeeper.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.tuple;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.photokeeper.config.AdobeConfig;
import com.photokeeper.config.RateLimitConfig;
import com.photokeeper.model.AlbumSummary;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

class LightroomServiceTest {

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
        // Real interceptor wiring, but a no-op sleeper so retries/backoff don't actually wait in tests.
        Sleeper noWait = millis -> {};
        RateLimitConfig rateLimitConfig = new RateLimitConfig();
        LightroomRateLimitInterceptor interceptor = new LightroomRateLimitInterceptor(
                new AdobeRateLimiter(rateLimitConfig, noWait), noWait, rateLimitConfig);
        service = new LightroomService(config, builder, new ObjectMapper(), interceptor);
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
    void getAllAlbumAssetsFollowsNextPageLinksUntilExhausted() {
        String page1 = LR_API_BASE + "/catalogs/cat-1/albums/alb-1/assets?embed=asset";
        server.expect(requestTo(page1))
                .andExpect(method(HttpMethod.GET))
                .andExpect(header("Authorization", "Bearer access-1"))
                .andExpect(header("X-API-Key", "test-api-key"))
                .andRespond(withSuccess(
                        "while (1) {}{\"resources\":[{\"asset\":{\"id\":\"a1\",\"subtype\":\"image\"}}],"
                                + "\"links\":{\"next\":{\"href\":\"albums/alb-1/assets?embed=asset&after=a1\"}}}",
                        MediaType.APPLICATION_JSON));

        String page2 = LR_API_BASE + "/catalogs/cat-1/albums/alb-1/assets?embed=asset&after=a1";
        server.expect(requestTo(page2))
                .andExpect(method(HttpMethod.GET))
                .andRespond(withSuccess(
                        "while (1) {}{\"resources\":[{\"asset\":{\"id\":\"a2\",\"subtype\":\"image\"}}]}",
                        MediaType.APPLICATION_JSON));

        List<Map<String, Object>> assets = service.getAllAlbumAssets("access-1", "cat-1", "alb-1");

        assertThat(assets).extracting(a -> a.get("id")).containsExactly("a1", "a2");
        server.verify();
    }

    @Test
    void getAllAlbumAssetsFollowsAbsoluteNextHref() {
        String page1 = LR_API_BASE + "/catalogs/cat-1/albums/alb-1/assets?embed=asset";
        String page2 = LR_API_BASE + "/catalogs/cat-1/albums/alb-1/assets?embed=asset&after=a1";
        server.expect(requestTo(page1))
                .andRespond(withSuccess(
                        "{\"resources\":[{\"asset\":{\"id\":\"a1\"}}],"
                                + "\"links\":{\"next\":{\"href\":\"" + page2 + "\"}}}",
                        MediaType.APPLICATION_JSON));
        server.expect(requestTo(page2))
                .andRespond(withSuccess(
                        "{\"resources\":[{\"asset\":{\"id\":\"a2\"}}]}", MediaType.APPLICATION_JSON));

        List<Map<String, Object>> assets = service.getAllAlbumAssets("access-1", "cat-1", "alb-1");

        assertThat(assets).extracting(a -> a.get("id")).containsExactly("a1", "a2");
        server.verify();
    }

    // A links block that doesn't resolve to a usable next-href must end pagination, not loop or fail.
    @ParameterizedTest
    @ValueSource(strings = {
        "\"links\":{}", // no next at all
        "\"links\":{\"next\":\"not-an-object\"}", // next isn't an object
        "\"links\":{\"next\":{}}", // next has no href
        "\"links\":{\"next\":{\"href\":\"\"}}", // href is blank
    })
    void getAllAlbumAssetsStopsWhenNextLinkIsUnusable(String linksJson) {
        String page1 = LR_API_BASE + "/catalogs/cat-1/albums/alb-1/assets?embed=asset";
        server.expect(requestTo(page1))
                .andRespond(withSuccess(
                        "{\"resources\":[{\"asset\":{\"id\":\"a1\"}}]," + linksJson + "}",
                        MediaType.APPLICATION_JSON));

        List<Map<String, Object>> assets = service.getAllAlbumAssets("access-1", "cat-1", "alb-1");

        assertThat(assets).extracting(a -> a.get("id")).containsExactly("a1");
        server.verify();
    }

    @Test
    void retriesOnTooManyRequestsThenSucceeds() {
        server.expect(requestTo(LR_API_BASE + "/catalog"))
                .andRespond(withStatus(HttpStatus.TOO_MANY_REQUESTS));
        server.expect(requestTo(LR_API_BASE + "/catalog"))
                .andRespond(withSuccess("{\"id\":\"cat-1\"}", MediaType.APPLICATION_JSON));

        assertThat(service.getCatalog("access-1")).containsEntry("id", "cat-1");
        server.verify();
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

    /**
     * Adding is not idempotent, which is the easy thing to assume and wrong: Lightroom answers 403
     * {@code ResourceExistsError} for a photo already in the album. Treated as a failure, every
     * already-filed photo would be retried on every sweep, for ever, and never recorded as done.
     */
    @Test
    void treatsAnAlreadyFiledPhotoAsFiled() {
        server.expect(requestTo(LR_API_BASE + "/catalogs/cat-1/albums/al-1/assets"))
                .andRespond(withStatus(HttpStatus.FORBIDDEN)
                        .body("{\"errors\":[{\"errors\":{\"asset\":[\"already in album\"]}}]}")
                        .contentType(MediaType.APPLICATION_JSON));

        service.addAssetsToAlbum("tok", "cat-1", "al-1", List.of("a1"));

        server.verify(); // no throw: the photo is where the caller wanted it
    }

    /**
     * A batch is left to fail, because the response cannot say which of its members were new — only
     * that the write as a whole was refused. The client splits it and retries one at a time.
     */
    @Test
    void lettesABatchFailSoTheCallerCanSplitIt() {
        server.expect(requestTo(LR_API_BASE + "/catalogs/cat-1/albums/al-1/assets"))
                .andRespond(withStatus(HttpStatus.FORBIDDEN)
                        .body("{\"errors\":[{\"errors\":{\"asset\":[\"already in album\"]}}]}")
                        .contentType(MediaType.APPLICATION_JSON));

        assertThatThrownBy(() -> service.addAssetsToAlbum("tok", "cat-1", "al-1", List.of("a1", "a2")))
                .isInstanceOf(RestClientResponseException.class);
    }

    @Test
    void doesNotCallLightroomForAnEmptyBatch() {
        service.addAssetsToAlbum("tok", "cat-1", "al-1", List.of());

        server.verify(); // no request expected, and none made
    }
}
