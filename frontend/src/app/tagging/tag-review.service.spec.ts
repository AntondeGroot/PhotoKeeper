import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { TagReviewService } from './tag-review.service';
import { AssetMetaStore } from '../storage/review/asset-meta-store';
import { ReviewStore } from '../storage/review/review-store';
import { PreviewCacheService } from '../review/preview-cache.service';
import { PreferencesService } from '../preferences.service';
import { TagState } from './tag-state.service';
import { DEFAULT_TAG_DIRECTIONS, TagDirections } from './tags';
import { Photo } from '../photo';
import { AssetMeta, StoredVerdict } from '../storage/photokeeper-db';

/** An asset in the library, with the verdict that decides whether it is taggable. */
type Asset = { id: string; status: Photo['status']; taken?: string };

const meta = (taken: string): AssetMeta => ({ albumId: 'al', name: 'n', taken });
const verdict = (status: Photo['status']): StoredVerdict => ({
  status,
  starred: false,
  keepsake: false,
});

describe('TagReviewService', () => {
  let service: TagReviewService;
  let library: Asset[];
  let tagDirections: ReturnType<typeof signal<TagDirections>>;
  // A signal so the service's computeds (taggedCount, progress) recompute when assignments change,
  // matching the real signal-backed TagState.
  let assignments: ReturnType<typeof signal<Map<string, string[]>>>;
  let applied: { assetId: string; tagId: string }[];
  let toggled: { assetId: string; tagId: string }[];

  /** Seeds the library and rebuilds the pass from it, as entering Tag mode does. */
  async function loadLibrary(assets: Asset[]): Promise<void> {
    library = assets;
    await service.load();
  }

  beforeEach(async () => {
    library = [
      { id: 'a', status: 'kept', taken: '2026-01-03' },
      { id: 'b', status: 'kept', taken: '2026-01-02' },
      { id: 'c', status: 'kept', taken: '2026-01-01' },
    ];
    tagDirections = signal<TagDirections>({ ...DEFAULT_TAG_DIRECTIONS });
    assignments = signal(new Map<string, string[]>());
    applied = [];
    toggled = [];

    TestBed.configureTestingModule({
      providers: [
        {
          provide: ReviewStore,
          useValue: {
            getVerdicts: () =>
              Promise.resolve(new Map(library.map((a) => [a.id, verdict(a.status)]))),
          },
        },
        {
          provide: AssetMetaStore,
          useValue: {
            getAll: () =>
              Promise.resolve(new Map(library.map((a) => [a.id, meta(a.taken ?? '2026-01-01')]))),
          },
        },
        {
          provide: PreviewCacheService,
          useValue: { url: (id: string) => `url:${id}`, ensure: () => Promise.resolve() },
        },
        {
          provide: TagState,
          useValue: {
            tagsFor: (id: string) => assignments().get(id) ?? [],
            apply: (assetId: string, tagId: string) => applied.push({ assetId, tagId }),
            toggle: (assetId: string, tagId: string) => toggled.push({ assetId, tagId }),
          },
        },
        { provide: PreferencesService, useValue: { tagGoal: () => 2, tagDirections } },
      ],
    });
    service = TestBed.inject(TagReviewService);
    await service.load();
  });

  it('taggablePhotos keeps only keepers (not backlog, not rejected)', async () => {
    await loadLibrary([
      { id: 'a', status: 'kept', taken: '2026-01-04' },
      { id: 'b', status: 'backlog', taken: '2026-01-03' },
      { id: 'c', status: 'rejected', taken: '2026-01-02' },
      { id: 'd', status: 'toEdit', taken: '2026-01-01' },
    ]);
    expect(service.taggablePhotos().map((p) => p.id)).toEqual(['a', 'd']);
  });

  it('leaves out keepers that already have tags, and reaches past the current deck', async () => {
    // 'b' was labelled on an earlier sitting. Everything here is a keeper from the library, not
    // from today's deck — which is the point: yesterday's keepers are no longer in the feed.
    assignments.set(new Map([['b', ['t1']]]));
    await loadLibrary([
      { id: 'a', status: 'kept', taken: '2026-01-03' },
      { id: 'b', status: 'kept', taken: '2026-01-02' },
      { id: 'c', status: 'toPrint', taken: '2026-01-01' },
    ]);

    // Newest first, and the tagged one is simply absent — this is what stops the pass handing back
    // the same photos every time it is entered.
    expect(service.taggablePhotos().map((p) => p.id)).toEqual(['a', 'c']);
    expect(service.currentPhoto().id).toBe('a');
  });

  it('tops up with the next batch, and stops offering when the backlog is empty', async () => {
    await loadLibrary([
      { id: 'a', status: 'kept', taken: '2026-01-03' },
      { id: 'b', status: 'kept', taken: '2026-01-02' },
      { id: 'c', status: 'kept', taken: '2026-01-01' },
    ]);
    expect(service.taggablePhotos().map((p) => p.id)).toEqual(['a', 'b']); // one batch of tagGoal

    await service.loadMore();

    // Appended, not replaced, and the cursor lands on the first of the new batch rather than
    // sending you back through photos you have already been shown.
    expect(service.taggablePhotos().map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(service.cursor()).toBe(2);

    // The whole backlog is now on screen, and the pass knows it — the offer withdraws straight
    // away rather than waiting for a press that would come back empty.
    expect(service.canLoadMore()).toBe(false);

    await service.loadMore(); // pressing anyway is a no-op, not a duplicate batch
    expect(service.taggablePhotos().length).toBe(3);
  });

  it('currentPhoto + currentPhotoUrl track the cursor', () => {
    expect(service.currentPhoto().id).toBe('a');
    expect(service.currentPhotoUrl()).toBe('url:a');
    service.next();
    expect(service.currentPhoto().id).toBe('b');
    expect(service.currentPhotoUrl()).toBe('url:b');
  });

  it('runs one step past the last photo to end the batch, and no further', async () => {
    service.prev();
    expect(service.cursor()).toBe(0); // can't go below 0

    // A batch is tagGoal photos (2 here), even though three keepers are waiting — the rest come
    // from a top-up, the way "Review more" tops up the deck.
    expect(service.taggablePhotos().length).toBe(2);

    service.next();
    service.next();
    // Off the end: no current photo, which is what lets the screen say the batch is done rather
    // than leaving the last card sitting there after it has been tagged.
    expect(service.cursor()).toBe(2);
    expect(service.currentPhoto()).toBeUndefined();

    service.next(); // and it stops there
    expect(service.cursor()).toBe(2);

    service.prev(); // still able to step back into the batch
    expect(service.currentPhoto().id).toBe('b');

    await service.load();
    expect(service.cursor()).toBe(0);
  });

  it('swipe() applies the direction-bound tag and advances; a no-op when unbound', () => {
    tagDirections.set({ up: 't1' }); // only "up" is bound
    service.swipe('up');
    expect(applied).toEqual([{ assetId: 'a', tagId: 't1' }]);
    expect(service.cursor()).toBe(1);

    service.swipe('down'); // no tag bound down → nothing applied, no advance
    expect(applied.length).toBe(1);
    expect(service.cursor()).toBe(1);
  });

  it('setDirection() binds a tag and keeps it unique across directions', () => {
    service.setDirection({ dir: 'up', tagId: 't1' });
    expect(tagDirections().up).toBe('t1');
    // Re-binding the same tag to another direction clears the old one.
    service.setDirection({ dir: 'down', tagId: 't1' });
    expect(tagDirections().up).toBeUndefined();
    expect(tagDirections().down).toBe('t1');
    // A null tagId clears the direction.
    service.setDirection({ dir: 'down', tagId: null });
    expect(tagDirections().down).toBeUndefined();
  });

  it('toggle() toggles the tag on the current photo', () => {
    service.toggle('t1');
    expect(toggled).toEqual([{ assetId: 'a', tagId: 't1' }]);
  });

  it('taggedCount + progressPercent count what this sitting has labelled', () => {
    tagDirections.set({ up: 't1' });
    expect(service.taggedCount()).toBe(0);

    service.swipe('up'); // 1 of a goal of 2 → 50%
    expect(service.taggedCount()).toBe(1);
    expect(service.progressPercent()).toBe(50);

    service.swipe('up'); // goal met, clamped at 100
    expect(service.progressPercent()).toBe(100);
  });
});
