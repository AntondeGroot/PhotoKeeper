import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ReviewStatsService } from './review-stats.service';
import { ReviewFeedService } from './review-feed.service';
import { ReviewDecisionsService } from './review-decisions.service';
import { PreferencesService } from '../preferences.service';
import { Photo, ReviewItem } from '../photo';

const photo = (id: string, status: Photo['status'], album: string | null = null): Photo => ({
  id,
  name: id,
  album,
  taken: '2026-01-01',
  status,
  kind: 'photo',
  starred: false,
  saveOnly: false,
});

describe('ReviewStatsService', () => {
  let service: ReviewStatsService;
  let photos: ReturnType<typeof signal<ReviewItem[]>>;
  let editedToday: ReturnType<typeof signal<number>>;

  beforeEach(() => {
    photos = signal<ReviewItem[]>([
      photo('a', 'kept', 'Trip'),
      photo('b', 'rejected'),
      photo('c', 'toEdit', 'Trip'),
      photo('d', 'toEdit', 'Home'),
      photo('e', 'toPrint', 'Home'),
      photo('f', 'maybe'),
      photo('g', 'backlog'),
    ]);
    editedToday = signal(0);

    TestBed.configureTestingModule({
      providers: [
        { provide: ReviewFeedService, useValue: { photos } },
        { provide: ReviewDecisionsService, useValue: { editedToday } },
        { provide: PreferencesService, useValue: { dailyGoal: () => 12, editGoal: () => 4 } },
      ],
    });
    service = TestBed.inject(ReviewStatsService);
  });

  it('tallies each verdict and the done/total session state', () => {
    expect(service.keptCount()).toBe(1);
    expect(service.rejectedCount()).toBe(1);
    expect(service.toEditCount()).toBe(2);
    expect(service.maybeCount()).toBe(1);
    expect(service.doneToday()).toBe(6); // everything except the one 'backlog'
    expect(service.sessionDone()).toBe(false); // 6 of 7
  });

  it('sessionDone is true once nothing is left in backlog', () => {
    photos.set([photo('a', 'kept'), photo('b', 'rejected')]);
    expect(service.sessionDone()).toBe(true);
  });

  it('computes goal progress, clamped to 100%', () => {
    expect(service.progressReviewPercent()).toBe(50); // 6 done / 12 goal
    editedToday.set(2);
    expect(service.progressEditPercent()).toBe(50); // 2 / 4 goal
    editedToday.set(99);
    expect(service.progressEditPercent()).toBe(100); // clamped
  });

  it('builds the Edit/Print queues (single photos only)', () => {
    expect(service.toEditQueue().map((p) => p.id)).toEqual(['c', 'd']);
    expect(service.toPrintQueue().map((p) => p.id)).toEqual(['e']);
  });

  it('caps the edit batch at the editing goal, even when more are queued', () => {
    // editGoal is 4; queue six toEdit photos → batch shows only the first four.
    photos.set(['a', 'b', 'c', 'd', 'e', 'f'].map((id) => photo(id, 'toEdit')));
    expect(service.toEditQueue().length).toBe(6);
    expect(service.editBatch().map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('editDone is true when the edit goal is met or the queue is empty', () => {
    expect(service.editDone()).toBe(false); // 0 edited, queue has c+d
    editedToday.set(4); // goal met
    expect(service.editDone()).toBe(true);
    editedToday.set(0);
    photos.set([photo('a', 'kept')]); // empty toEdit queue
    expect(service.editDone()).toBe(true);
  });

  it('groups the Edit/Print queues by album (null → "No album")', () => {
    expect(service.toEditByAlbum()).toEqual([
      { album: 'Trip', photos: [expect.objectContaining({ id: 'c' })] },
      { album: 'Home', photos: [expect.objectContaining({ id: 'd' })] },
    ]);
    expect(service.toPrintByAlbum()).toEqual([
      { album: 'Home', photos: [expect.objectContaining({ id: 'e' })] },
    ]);
  });
});
