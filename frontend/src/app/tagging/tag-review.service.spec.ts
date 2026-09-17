import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { TagReviewService } from './tag-review.service';
import { AssetMetaStore } from '../storage/review/asset-meta-store';
import { ReviewStore } from '../storage/review/review-store';
import { PreviewCacheService } from '../review/preview-cache.service';
import { PreferencesService } from '../preferences.service';
import { GroupStore } from '../storage/detection/group-store';
import { PhotoMergeStore } from '../storage/review/photo-merge-store';
import { DetectedGroup } from '../detection/detectors/detection-types';
import { MergedPhotoRecord } from '../storage/review/photo-merge-store';
import { TagState } from './tag-state.service';
import { ReviewUndoService } from '../review/review-undo.service';
import { DEFAULT_TAG_DIRECTIONS, TagDirections } from './tags';
import { Photo } from '../photo';
import { AssetMeta, StoredVerdict } from '../storage/photokeeper-db';

/** An asset in the library, with the verdict that decides whether it is taggable. */
type Asset = { id: string; status: Photo['status']; taken?: string; name?: string };

const meta = (taken: string, name = 'n'): AssetMeta => ({ albumId: 'al', name, taken });
const verdict = (status: Photo['status']): StoredVerdict => ({
  status,
  starred: false,
  saveOnly: false,
});

describe('TagReviewService', () => {
  let service: TagReviewService;
  let library: Asset[];
  /** Detected groups and recorded merges: what makes several files one photograph. */
  let groups: DetectedGroup[];
  let mergeRecords: Map<string, MergedPhotoRecord>;
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
    groups = [];
    mergeRecords = new Map();
    library = [
      { id: 'a', status: 'kept', taken: '2026-01-03' },
      { id: 'b', status: 'kept', taken: '2026-01-02' },
      { id: 'c', status: 'kept', taken: '2026-01-01' },
    ];
    // The tag tally is now the day's, persisted, so it survives between tests as it does between
    // sittings. Cleared here so each test starts from a known count.
    localStorage.removeItem('daily-progress');
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
              Promise.resolve(
                new Map(library.map((a) => [a.id, meta(a.taken ?? '2026-01-01', a.name ?? a.id)])),
              ),
          },
        },
        {
          provide: PreviewCacheService,
          useValue: { url: (id: string) => `url:${id}`, ensure: () => Promise.resolve() },
        },
        {
          provide: TagState,
          // Writes as well as records: the real one stores what it is given, and the service now
          // asks afterwards whether anything actually changed — a stub that only remembered the
          // call would answer no, and nothing would be counted or made undoable.
          useValue: {
            // The catalogue, so an undo row can be named by the tag rather than by "Tagged".
            tags: () => [
              { id: 't1', name: 'Tag one' },
              { id: 't2', name: 'Tag two' },
            ],
            tagsFor: (id: string) => assignments().get(id) ?? [],
            apply: (assetId: string, tagId: string) => {
              applied.push({ assetId, tagId });
              assignments.update((map) => new Map(map).set(assetId, [tagId]));
            },
            toggle: (assetId: string, tagId: string) => {
              toggled.push({ assetId, tagId });
              const had = assignments().get(assetId) ?? [];
              assignments.update((map) =>
                new Map(map).set(assetId, had.includes(tagId) ? [] : [tagId]),
              );
            },
            restore: (assetId: string, tagIds: string[]) =>
              assignments.update((map) => new Map(map).set(assetId, [...tagIds])),
          },
        },
        { provide: PreferencesService, useValue: { tagGoal: () => 2, tagDirections } },
        // What makes several files one photograph: a detected group, or a recorded merge.
        { provide: GroupStore, useValue: { getAll: () => Promise.resolve(groups) } },
        { provide: PhotoMergeStore, useValue: { getAll: () => Promise.resolve(mergeRecords) } },
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

  it('swipe() into the reserved corner labels the photo "no tag" and moves on', () => {
    // The pool is the untagged keepers, so declining a photo has to leave a mark — otherwise it
    // comes back in every later pass.
    tagDirections.set({ up: 't1' });

    service.swipe('down-right');

    expect(applied).toEqual([{ assetId: 'a', tagId: 'no-tag' }]);
    expect(service.cursor()).toBe(1);
  });

  it('swipe() into the reserved corner ignores anything bound there', () => {
    tagDirections.set({ 'down-right': 't1' }); // a stale binding cannot outrank "no tag"

    service.swipe('down-right');

    expect(applied).toEqual([{ assetId: 'a', tagId: 'no-tag' }]);
  });

  it('setDirection() refuses to bind the reserved corner', () => {
    service.setDirection({ dir: 'down-right', tagId: 't1' });

    expect(tagDirections()['down-right']).toBeUndefined();
  });

  it('setDirection() binds a corner like any other direction', () => {
    service.setDirection({ dir: 'up-left', tagId: 't1' });

    expect(tagDirections()['up-left']).toBe('t1');
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

  /**
   * The other half of the undo the Sort and Edit passes already had, and the same list: a mis-swipe
   * is a mis-swipe wherever it happened, and a tag is the easiest of all to make — one swipe, no
   * confirmation. The row has to name the tag, not just say "Tagged", or it answers nothing.
   */
  describe('taking a tag back', () => {
    let undoStack: ReviewUndoService;

    beforeEach(() => {
      tagDirections.set({ up: 't1', down: 't2' });
      undoStack = TestBed.inject(ReviewUndoService);
    });

    it('records the swipe in the shared list, named by the tag', () => {
      const photo = service.currentPhoto()?.id;

      service.swipe('up');

      const [entry] = undoStack.recent();
      expect(entry.outcome).toBe('tagged');
      expect(entry.label).toBe('Tag one'); // the tag's name, not "Tagged"
      expect(entry.unit.id).toBe(photo);
    });

    it('puts the photo back to having no tag, and the cursor back to it', async () => {
      const photo = service.currentPhoto()?.id ?? '';
      service.swipe('up');
      expect(service.cursor()).toBe(1);

      await service.undoTag(undoStack.recent()[0]);

      expect(assignments().get(photo)).toEqual([]);
      expect(service.cursor()).toBe(0);
      expect(undoStack.recent()).toHaveLength(0);
    });

    /** Correcting a tag is undoable too, and back to the earlier tag rather than to nothing. */
    it('restores the tag a correction replaced', async () => {
      const photo = service.currentPhoto()?.id ?? '';
      service.swipe('up'); // t1
      service.cursor.set(0);
      service.swipe('down'); // corrected to t2

      await service.undoTag(undoStack.recent()[0]);

      expect(assignments().get(photo)).toEqual(['t1']);
    });

    /**
     * The day's tag tally is a running count, unlike the review one which is read off the deck. So
     * taking a tag back has to un-count it, or the day stays one ahead of the work.
     */
    it('takes the day’s count back with it', async () => {
      service.swipe('up');
      expect(service.taggedCount()).toBe(1);

      await service.undoTag(undoStack.recent()[0]);

      expect(service.taggedCount()).toBe(0);
    });

    /** Only the first tag on a photo counted, so only that one un-counts. */
    it('does not un-count a correction, which never counted', async () => {
      service.swipe('up');
      service.cursor.set(0);
      service.swipe('down'); // a correction: the photo was already tagged
      expect(service.taggedCount()).toBe(1);

      await service.undoTag(undoStack.recent()[0]);

      expect(service.taggedCount()).toBe(1);
    });

    /** Any of them, not just the last — which is the point of a list rather than one button. */
    it('takes back the one that was chosen', async () => {
      const first = service.currentPhoto()?.id ?? '';
      service.swipe('up');
      const second = service.currentPhoto()?.id ?? '';
      service.swipe('down');

      const older = undoStack.recent()[1]; // newest first, so this is the first swipe
      await service.undoTag(older);

      expect(assignments().get(first)).toEqual([]);
      expect(assignments().get(second)).toEqual(['t2']);
    });

    it('holds nothing back from the Lightroom sweep — a tag is not filed', () => {
      service.swipe('up');

      expect(undoStack.heldAssetIds().size).toBe(0);
    });
  });

  it('taggedCount + progressPercent count what the day has labelled', () => {
    tagDirections.set({ up: 't1' });
    expect(service.taggedCount()).toBe(0);

    service.swipe('up'); // 1 of a goal of 2 → 50%
    expect(service.taggedCount()).toBe(1);
    expect(service.progressPercent()).toBe(50);

    service.swipe('up'); // goal met, clamped at 100
    expect(service.progressPercent()).toBe(100);
  });

  /**
   * The bug this replaced. Entering Tag mode rebuilds the pass, and the count used to be rebuilt
   * with it — so leaving for another tab and coming back said 0 again, while the streak, reading the
   * same day's persisted tally, already knew about the ones just done.
   */
  it('keeps the day’s count when the pass is entered again', async () => {
    tagDirections.set({ up: 't1' });
    service.swipe('up');
    expect(service.taggedCount()).toBe(1);

    await service.load(); // what switching to another tab and back does

    expect(service.taggedCount()).toBe(1);
  });

  /**
   * The complaint this fixes: having tagged a photograph, being asked about the denoise Lightroom
   * wrote beside it — and then about every frame of a sweep, and the panorama stitched from them. A
   * tag is about what is in the picture, and they are all pictures of the same thing.
   */
  describe('files that are one photograph', () => {
    /** A shot and its denoise, plus an unrelated photograph to prove the line is drawn somewhere. */
    const pair: Asset[] = [
      { id: 'raw', status: 'kept', name: 'DSC_1878', taken: '2026-01-03' },
      { id: 'dng', status: 'kept', name: 'DSC_1878-Enhanced-NR', taken: '2026-01-03' },
      { id: 'other', status: 'kept', name: 'DSC_9999', taken: '2026-01-01' },
    ];

    it('asks about the photograph once, not once per file', async () => {
      await loadLibrary(pair);

      expect(service.taggablePhotos().map((p) => p.id)).toEqual(['raw', 'other']);
    });

    it('labels every file of it', async () => {
      tagDirections.set({ up: 't1' });
      await loadLibrary(pair);

      service.swipe('up');

      const labelled = applied
        .filter((a) => a.tagId === 't1')
        .map((a) => a.assetId)
        .sort((a, b) => a.localeCompare(b));
      expect(labelled).toEqual(['dng', 'raw']);
    });

    it('does not ask again about a shot one of whose files is already tagged', async () => {
      assignments.set(new Map([['dng', ['t1']]]));

      await loadLibrary(pair);

      expect(service.taggablePhotos().map((p) => p.id)).toEqual(['other']);
    });

    /**
     * A burst is the exception: several attempts at one moment, judged one at a time on purpose, so
     * the frames that survive the duel are separate photographs and are labelled separately.
     */
    it('asks about each surviving frame of a burst', async () => {
      groups = [{ type: 'burst', sourceAlbumId: 'al', memberIds: ['b1', 'b2'] }];

      await loadLibrary([
        { id: 'b1', status: 'kept', name: 'DSC_1', taken: '2026-01-03' },
        { id: 'b2', status: 'kept', name: 'DSC_2', taken: '2026-01-02' },
      ]);

      expect(service.taggablePhotos().map((p) => p.id)).toEqual(['b1', 'b2']);
    });

    /** The frames of a sweep, and the panorama stitched from them, are one photograph too. */
    it('joins a sweep and its panorama', async () => {
      groups = [{ type: 'pano', sourceAlbumId: 'al', memberIds: ['f1', 'f2'] }];

      await loadLibrary([
        { id: 'f1', status: 'kept', name: 'DSC_1', taken: '2026-01-03' },
        { id: 'f2', status: 'kept', name: 'DSC_2', taken: '2026-01-03' },
        { id: 'pano', status: 'kept', name: 'DSC_2-Pano', taken: '2026-01-03' },
      ]);
      service.swipe('up');

      expect(service.taggablePhotos()).toHaveLength(1);
      const labelled = applied.map((a) => a.assetId).sort((a, b) => a.localeCompare(b));
      expect(labelled).toEqual(['f1', 'f2', 'pano']);
    });
  });
});
