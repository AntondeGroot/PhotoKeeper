package com.photokeeper.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.photokeeper.model.AlbumSummary;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Random;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class PhotoFeedServiceTest {

    @Mock private LightroomService lightroom;
    private PhotoFeedService service;

    @BeforeEach
    void setUp() {
        // Seeded Random makes the weighted shuffle deterministic across runs.
        service = new PhotoFeedService(lightroom, new Random(42));
    }

    // Mutable, because buildFeed tags each asset with its album name via Map.put.
    private static Map<String, Object> asset(String id) {
        Map<String, Object> map = new HashMap<>();
        map.put("id", id);
        map.put("subtype", "image");
        return map;
    }

    private static List<Map<String, Object>> assets(String prefix, int count) {
        List<Map<String, Object>> list = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            list.add(asset(prefix + i));
        }
        return list;
    }

    private static Object idOf(Object asset) {
        return Objects.requireNonNull(((Map<?, ?>) asset).get("id"));
    }

    @Test
    void fallsBackToCatalogAssetsWhenNoAlbums() {
        when(lightroom.getAlbums("tok", "cat")).thenReturn(List.of());
        when(lightroom.getAssets("tok", "cat", 20))
                .thenReturn(Map.of("resources", List.of(asset("a"), asset("b"))));

        List<Object> feed = service.buildFeed("tok", "cat", Set.of(), 20);

        assertThat(feed).extracting(PhotoFeedServiceTest::idOf).containsExactlyInAnyOrder("a", "b");
    }

    @Test
    void returnsEmptyWhenNoAlbumsAndNoResources() {
        when(lightroom.getAlbums("tok", "cat")).thenReturn(List.of());
        when(lightroom.getAssets("tok", "cat", 20)).thenReturn(Map.of());

        assertThat(service.buildFeed("tok", "cat", Set.of(), 20)).isEmpty();
    }

    @Test
    void collectsAssetsAcrossAlbumsDedupedById() {
        when(lightroom.getAlbums("tok", "cat"))
                .thenReturn(List.of(new AlbumSummary("alb-1", "A"), new AlbumSummary("alb-2", "B")));
        when(lightroom.getAlbumAssets("tok", "cat", "alb-1", 20))
                .thenReturn(List.of(asset("x"), asset("y")));
        when(lightroom.getAlbumAssets("tok", "cat", "alb-2", 20))
                .thenReturn(List.of(asset("y"), asset("z")));

        List<Object> feed = service.buildFeed("tok", "cat", Set.of(), 20);

        assertThat(feed)
                .extracting(PhotoFeedServiceTest::idOf)
                .containsExactlyInAnyOrder("x", "y", "z");
    }

    @Test
    void spreadsAcrossAlbumsAndTagsEachAssetWithItsAlbumName() {
        when(lightroom.getAlbums("tok", "cat"))
                .thenReturn(List.of(new AlbumSummary("alb-1", "Lisbon"), new AlbumSummary("alb-2", "Peaks")));
        when(lightroom.getAlbumAssets("tok", "cat", "alb-1", 8)).thenReturn(assets("l", 10));
        when(lightroom.getAlbumAssets("tok", "cat", "alb-2", 8)).thenReturn(assets("p", 10));

        // Limit 8 = ASSETS_PER_ALBUM (4) × 2 albums, so the spread pass fills it: 4 from each album.
        List<Object> feed = service.buildFeed("tok", "cat", Set.of(), 8);

        assertThat(feed).hasSize(8);
        assertThat(feed.stream().filter(a -> "Lisbon".equals(((Map<?, ?>) a).get("album")))).hasSize(4);
        assertThat(feed.stream().filter(a -> "Peaks".equals(((Map<?, ?>) a).get("album")))).hasSize(4);
    }

    @Test
    void fillsTheLimitFromLeftoversBeyondThePerAlbumSpreadCap() {
        when(lightroom.getAlbums("tok", "cat"))
                .thenReturn(List.of(new AlbumSummary("alb-1", "Lisbon"), new AlbumSummary("alb-2", "Peaks")));
        when(lightroom.getAlbumAssets("tok", "cat", "alb-1", 20)).thenReturn(assets("l", 10));
        when(lightroom.getAlbumAssets("tok", "cat", "alb-2", 20)).thenReturn(assets("p", 10));

        // 20 unique assets, goal 20: the spread pass takes 4+4, the fill pass tops up to the full 20.
        List<Object> feed = service.buildFeed("tok", "cat", Set.of(), 20);

        assertThat(feed).hasSize(20);
        assertThat(feed).extracting(PhotoFeedServiceTest::idOf).doesNotHaveDuplicates();
    }

    @Test
    void stopsFetchingAlbumsOnceTheLimitIsReached() {
        when(lightroom.getAlbums("tok", "cat"))
                .thenReturn(List.of(new AlbumSummary("alb-1", "A"), new AlbumSummary("alb-2", "B")));
        when(lightroom.getAlbumAssets(eq("tok"), eq("cat"), anyString(), eq(4)))
                .thenReturn(assets("a", 4));

        List<Object> feed = service.buildFeed("tok", "cat", Set.of(), 4);

        assertThat(feed).hasSize(4);
        verify(lightroom, times(1)).getAlbumAssets(eq("tok"), eq("cat"), anyString(), eq(4));
    }

    @Test
    void skipsAssetsWithoutAStringId() {
        when(lightroom.getAlbums("tok", "cat")).thenReturn(List.of(new AlbumSummary("alb-1", "A")));
        when(lightroom.getAlbumAssets("tok", "cat", "alb-1", 20))
                .thenReturn(List.of(Map.<String, Object>of("noId", 1), asset("x")));

        List<Object> feed = service.buildFeed("tok", "cat", Set.of(), 20);

        assertThat(feed).extracting(PhotoFeedServiceTest::idOf).containsExactly("x");
    }

    @Test
    void fallsBackToCatalogAssetsWhenAlbumSamplingYieldsNothing() {
        when(lightroom.getAlbums("tok", "cat")).thenReturn(List.of(new AlbumSummary("alb-1", "A")));
        when(lightroom.getAlbumAssets("tok", "cat", "alb-1", 20)).thenReturn(List.of());
        when(lightroom.getAssets("tok", "cat", 20))
                .thenReturn(Map.of("resources", List.of(asset("flat"))));

        List<Object> feed = service.buildFeed("tok", "cat", Set.of(), 20);

        assertThat(feed).extracting(PhotoFeedServiceTest::idOf).containsExactly("flat");
    }

    @Test
    void fallsBackToCatalogAssetsWhenAlbumPathThrows() {
        when(lightroom.getAlbums("tok", "cat")).thenThrow(new RuntimeException("boom"));
        when(lightroom.getAssets("tok", "cat", 20))
                .thenReturn(Map.of("resources", List.of(asset("flat"))));

        List<Object> feed = service.buildFeed("tok", "cat", Set.of(), 20);

        assertThat(feed).extracting(PhotoFeedServiceTest::idOf).containsExactly("flat");
    }

    @Test
    void capsTheResultAtTheLimit() {
        when(lightroom.getAlbums("tok", "cat")).thenReturn(List.of(new AlbumSummary("alb-1", "A")));
        when(lightroom.getAlbumAssets("tok", "cat", "alb-1", 2))
                .thenReturn(List.of(asset("a"), asset("b"), asset("c")));

        List<Object> feed = service.buildFeed("tok", "cat", Set.of(), 2);

        assertThat(feed).hasSize(2);
    }

    @Test
    void weightedAlbumOrderIsADeDupedPermutationOfAlbumIds() {
        List<String> order = service.weightedAlbumOrder(
                List.of(new AlbumSummary("vac", "Vacation"), new AlbumSummary("nor", "Normal")),
                Set.of("vac"));

        assertThat(order).containsExactlyInAnyOrder("vac", "nor");
    }
}
