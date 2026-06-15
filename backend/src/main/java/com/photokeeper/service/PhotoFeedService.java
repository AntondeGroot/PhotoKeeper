package com.photokeeper.service;

import com.photokeeper.model.AlbumSummary;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * Builds the daily review feed by sampling assets across the catalog's albums, giving albums the
 * user has tagged as "vacation" a higher chance of being drawn. Falls back to a flat catalog-wide
 * fetch when the catalog has no albums.
 */
@Service
public class PhotoFeedService {

    private static final Logger log = LoggerFactory.getLogger(PhotoFeedService.class);

    /** A vacation album is this many times more likely to be drawn than a normal album. */
    private static final int VACATION_WEIGHT = 3;

    /** Max photos taken from any one album, so the feed spreads across several albums. */
    private static final int ASSETS_PER_ALBUM = 4;

    private final LightroomService lightroom;
    private final Random rng;

    @Autowired
    public PhotoFeedService(LightroomService lightroom) {
        this(lightroom, new SecureRandom());
    }

    /* default */ PhotoFeedService(LightroomService lightroom, Random rng) {
        // Package-private: lets tests inject a seeded Random for deterministic ordering.
        this.lightroom = lightroom;
        this.rng = rng;
    }

    public List<Object> buildFeed(
            String accessToken, String catalogId, Set<String> vacationAlbumIds, int limit) {
        try {
            List<AlbumSummary> albums = lightroom.getAlbums(accessToken, catalogId);
            if (!albums.isEmpty()) {
                List<Object> picked = collectAssets(accessToken, catalogId, albums, vacationAlbumIds, limit);
                if (!picked.isEmpty()) {
                    Collections.shuffle(picked, rng);
                    return picked.size() > limit ? new ArrayList<>(picked.subList(0, limit)) : picked;
                }
            }
        } catch (RuntimeException e) {
            log.warn("Album-weighted feed failed, using flat catalog fallback: {}", e.toString());
        }

        // No albums, album sampling produced nothing, or the album path failed: fall back to a flat
        // catalog fetch so the review feed still gets real photos.
        return catalogFallback(accessToken, catalogId, limit);
    }

    private List<Object> catalogFallback(String accessToken, String catalogId, int limit) {
        Object resources = lightroom.getAssets(accessToken, catalogId, limit).get("resources");
        return resources instanceof List<?> list ? new ArrayList<>(list) : List.of();
    }

    private Map<String, String> albumNamesById(List<AlbumSummary> albums) {
        Map<String, String> names = new HashMap<>();
        for (AlbumSummary album : albums) {
            names.put(album.id(), album.name());
        }
        return names;
    }

    private List<Object> collectAssets(
            String accessToken,
            String catalogId,
            List<AlbumSummary> albums,
            Set<String> vacationAlbumIds,
            int limit) {
        Map<String, String> albumNames = albumNamesById(albums);
        List<Object> picked = new ArrayList<>();
        Set<String> seenAssetIds = new HashSet<>();
        for (String albumId : weightedAlbumOrder(albums, vacationAlbumIds)) {
            if (picked.size() >= limit) {
                break;
            }
            List<Map<String, Object>> albumAssets =
                    new ArrayList<>(lightroom.getAlbumAssets(accessToken, catalogId, albumId, limit));
            Collections.shuffle(albumAssets, rng);

            int takenFromAlbum = 0;
            for (Map<String, Object> asset : albumAssets) {
                if (picked.size() >= limit || takenFromAlbum >= ASSETS_PER_ALBUM) {
                    break;
                }
                if (asset.get("id") instanceof String assetId && seenAssetIds.add(assetId)) {
                    asset.put("album", albumNames.get(albumId));
                    picked.add(asset);
                    takenFromAlbum++;
                }
            }
        }
        return picked;
    }

    /**
     * Produces a shuffled, de-duplicated album order in which vacation albums are over-represented
     * (added {@link #VACATION_WEIGHT} times before the shuffle), so they tend to appear earlier and
     * thus contribute more photos before the limit is reached.
     */
    /* default */ List<String> weightedAlbumOrder(
            List<AlbumSummary> albums, Set<String> vacationAlbumIds) {
        List<String> pool = new ArrayList<>();
        for (AlbumSummary album : albums) {
            int weight = vacationAlbumIds.contains(album.id()) ? VACATION_WEIGHT : 1;
            for (int i = 0; i < weight; i++) {
                pool.add(album.id());
            }
        }
        Collections.shuffle(pool, rng);

        List<String> order = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (String albumId : pool) {
            if (seen.add(albumId)) {
                order.add(albumId);
            }
        }
        return order;
    }
}
