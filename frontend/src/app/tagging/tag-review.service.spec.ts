import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { TagReviewService } from './tag-review.service';
import { ReviewFeedService } from '../review/review-feed.service';
import { PreviewCacheService } from '../review/preview-cache.service';
import { PreferencesService } from '../preferences.service';
import { TagState } from './tag-state.service';
import { DEFAULT_TAG_DIRECTIONS, TagDirections } from './tags';
import { Photo, ReviewItem } from '../photo';

const photo = (id: string, status: Photo['status'] = 'kept'): Photo => ({
  id,
  name: id,
  album: null,
  taken: '2026-01-01',
  status,
  kind: 'photo',
  starred: false,
  keepsake: false,
});

describe('TagReviewService', () => {
  let service: TagReviewService;
  let photos: ReturnType<typeof signal<ReviewItem[]>>;
  let tagDirections: ReturnType<typeof signal<TagDirections>>;
  // A signal so the service's computeds (taggedCount, progress) recompute when assignments change,
  // matching the real signal-backed TagState.
  let assignments: ReturnType<typeof signal<Map<string, string[]>>>;
  let applied: { assetId: string; tagId: string }[];
  let toggled: { assetId: string; tagId: string }[];

  beforeEach(() => {
    photos = signal<ReviewItem[]>([photo('a'), photo('b'), photo('c')]);
    tagDirections = signal<TagDirections>({ ...DEFAULT_TAG_DIRECTIONS });
    assignments = signal(new Map<string, string[]>());
    applied = [];
    toggled = [];

    TestBed.configureTestingModule({
      providers: [
        { provide: ReviewFeedService, useValue: { photos } },
        { provide: PreviewCacheService, useValue: { url: (id: string) => `url:${id}` } },
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
  });

  it('taggablePhotos keeps only keepers (not backlog, not rejected)', () => {
    photos.set([
      photo('a', 'kept'),
      photo('b', 'backlog'),
      photo('c', 'rejected'),
      photo('d', 'toEdit'),
    ]);
    expect(service.taggablePhotos().map((p) => p.id)).toEqual(['a', 'd']);
  });

  it('currentPhoto + currentPhotoUrl track the cursor', () => {
    expect(service.currentPhoto().id).toBe('a');
    expect(service.currentPhotoUrl()).toBe('url:a');
    service.next();
    expect(service.currentPhoto().id).toBe('b');
    expect(service.currentPhotoUrl()).toBe('url:b');
  });

  it('next()/prev() are bounded to the pool, reset() returns to the first', () => {
    service.prev();
    expect(service.cursor()).toBe(0); // can't go below 0
    service.next();
    service.next();
    service.next(); // only 3 photos → clamps at index 2
    expect(service.cursor()).toBe(2);
    service.reset();
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

  it('taggedCount + progressPercent reflect how many keepers have a tag', () => {
    assignments.set(new Map([['a', ['t1']]])); // 1 of 3 tagged, goal 2 → 50%
    expect(service.taggedCount()).toBe(1);
    expect(service.progressPercent()).toBe(50);
    assignments.set(
      new Map([
        ['a', ['t1']],
        ['b', ['t2']],
      ]),
    ); // 2 of 3 → goal met, clamped at 100
    expect(service.progressPercent()).toBe(100);
  });
});
