import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ReviewDecisionsService } from './review-decisions.service';
import { ReviewFeedService } from './review-feed.service';
import { todayKey } from './day';
import { ReviewStore } from '../storage/review/review-store';
import { GroupOverrideStore } from '../storage/detection/group-override-store';
import { BackgroundScanService } from '../detection/scan/background-scan.service';
import { PreferencesService } from '../preferences.service';
import { Burst, Pano, Photo, ReviewItem } from '../photo';
import { StoredVerdict } from '../storage/photokeeper-db';

const photo = (id: string, status: Photo['status'] = 'backlog'): Photo => ({
  id,
  name: id,
  album: null,
  taken: '2026-01-01',
  status,
  kind: 'photo',
  starred: false,
  saveOnly: false,
});

const burst = (id: string, frameIds: string[]): Burst => ({
  id,
  name: id,
  album: 'Trip',
  taken: '2026-01-01',
  status: 'backlog',
  kind: 'burst',
  photos: frameIds.map((fid) => ({ id: fid, name: fid })),
});

const pano = (id: string, frameIds: string[]): Pano => ({
  id,
  name: `Panorama · ${frameIds.length} frames`,
  album: 'Trip',
  taken: '2026-01-01',
  status: 'backlog',
  kind: 'pano',
  orientation: 'horizontal',
  frames: frameIds.map((fid) => ({ id: fid, name: fid })),
});

describe('ReviewDecisionsService', () => {
  let service: ReviewDecisionsService;
  // Minimal fake feed: a writable deck + cursor with the three navigation helpers the service uses.
  let photos: ReturnType<typeof signal<ReviewItem[]>>;
  let index: ReturnType<typeof signal<number>>;
  let loaded: ReturnType<typeof signal<boolean>>;
  let verdicts: { id: string; verdict: StoredVerdict }[];
  /** What is stored right now, so undo can be checked against it rather than against the call log. */
  let stored: Map<string, StoredVerdict>;
  let dailyFeeds: Map<string, ReviewItem[]>;
  let dissolves: { memberIds: string[] }[];
  let reclassifies: { memberIds: string[]; type: string; orientation?: string }[];
  let memberships: { memberIds: string[]; frameIds: string[]; at: number }[];
  let refillCalls: number;

  beforeEach(() => {
    photos = signal<ReviewItem[]>([photo('a'), photo('b'), photo('c')]);
    index = signal(0);
    loaded = signal(true);
    verdicts = [];
    stored = new Map();
    dailyFeeds = new Map();
    dissolves = [];
    reclassifies = [];
    memberships = [];
    refillCalls = 0;
    localStorage.removeItem('celebratedGoal');

    const feed = {
      photos,
      index,
      loaded,
      current: () => photos()[index()],
      advance: () => {
        if (index() < photos().length - 1) index.update((i) => i + 1);
      },
      back: () => {
        if (index() > 0) index.update((i) => i - 1);
      },
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: ReviewFeedService, useValue: feed },
        {
          provide: ReviewStore,
          useValue: {
            setVerdict: (id: string, verdict: StoredVerdict) => {
              verdicts.push({ id, verdict });
              stored.set(id, verdict);
              return Promise.resolve();
            },
            removeVerdict: (id: string) => {
              stored.delete(id);
              return Promise.resolve();
            },
            loadedVerdicts: () => stored,
            setDailyFeed: (k: string, v: ReviewItem[]) => {
              dailyFeeds.set(k, v);
              return Promise.resolve();
            },
          },
        },
        {
          provide: GroupOverrideStore,
          useValue: {
            dissolve: (o: { memberIds: string[] }) => {
              dissolves.push(o);
              return Promise.resolve();
            },
            reclassify: (o: { memberIds: string[]; type: string; orientation?: string }) => {
              reclassifies.push(o);
              return Promise.resolve();
            },
            setMembers: (o: { memberIds: string[]; frameIds: string[]; at: number }) => {
              memberships.push(o);
              return Promise.resolve();
            },
          },
        },
        { provide: BackgroundScanService, useValue: { scheduleRefill: () => refillCalls++ } },
        { provide: PreferencesService, useValue: { dailyGoal: () => 99 } },
      ],
    });
    service = TestBed.inject(ReviewDecisionsService);
    service.bindAuth(() => true);
  });

  it('decide() sets the current unit status, persists it, and advances the cursor', async () => {
    service.decide('kept');
    await Promise.resolve();
    expect(photos()[0].status).toBe('kept');
    expect(index()).toBe(1);
    expect(verdicts).toEqual([
      { id: 'a', verdict: { status: 'kept', starred: false, saveOnly: false } },
    ]);
    expect(refillCalls).toBe(1); // every decision tops up the scan buffer
  });

  describe('undo', () => {
    /** Takes back the most recent decision — what the list's top row does. */
    const undoLatest = () => service.undo(service.recentDecisions()[0]);

    it('offers nothing until a decision has been made', () => {
      expect(service.canUndo()).toBe(false);
      expect(service.recentDecisions()).toEqual([]);
    });

    it('puts the unit, the cursor and the verdict back', async () => {
      service.decide('kept');
      await Promise.resolve();

      await undoLatest();

      expect(photos()[0].status).toBe('backlog');
      expect(index()).toBe(0);
      // Removed, not stored as 'backlog': the sweep reads every stored verdict, so a placeholder
      // would be filed as though the photo had been decided.
      expect(stored.has('a')).toBe(false);
      expect(service.canUndo()).toBe(false);
    });

    it('lists what was decided, most recent first', async () => {
      service.decide('kept');
      service.decide('rejected');
      await Promise.resolve();

      expect(service.recentDecisions().map((e) => [e.unit.id, e.outcome])).toEqual([
        ['b', 'rejected'],
        ['a', 'kept'],
      ]);
    });

    /**
     * Changing an answer twice must land on the first answer, not on "undecided". A photo can be
     * re-decided once it has been brought back, and undoing that has to restore what was there.
     */
    it('restores an earlier verdict rather than clearing it', async () => {
      stored.set('a', { status: 'rejected', starred: false, saveOnly: false });

      service.decide('kept');
      await Promise.resolve();
      await undoLatest();

      expect(stored.get('a')).toEqual({ status: 'rejected', starred: false, saveOnly: false });
    });

    /**
     * A burst writes a verdict per frame as well as one for the unit, so undoing it has to clear all
     * of them — a frame left rejected would keep it out of every later selection.
     */
    it('puts back every frame verdict a burst duel wrote', async () => {
      photos.set([burst('b1', ['f1', 'f2', 'f3'])]);
      index.set(0);

      service.resolveBurst(['f1']);
      await Promise.resolve();
      expect(stored.size).toBe(4); // the unit and its three frames

      await undoLatest();

      expect(stored.size).toBe(0);
      expect(photos()[0].status).toBe('backlog');
    });

    /** Skipping writes no verdict at all, so only the recorded unit can bring it back. */
    it('brings back a unit that was skipped off the deck', async () => {
      service.withdrawCurrentUnit();
      expect(photos().map((p) => p.id)).toEqual(['b', 'c']);

      await undoLatest();

      expect(photos().map((p) => p.id)).toEqual(['a', 'b', 'c']);
      expect(index()).toBe(0);
    });

    /**
     * Undo takes back one decision, not everything that happened since. The unit is put back on its
     * own for exactly this: rolling the whole deck back would quietly discard the star, and the
     * photo would then disagree with its own stored verdict.
     */
    it('leaves alone what was done to other photos afterwards', async () => {
      service.decide('kept'); // decides 'a', cursor moves to 'b'
      service.toggleStar(); // stars 'b', which is nobody's undo
      await Promise.resolve();

      await undoLatest();

      expect((photos().find((p) => p.id === 'b') as Photo).starred).toBe(true);
      expect(photos()[0].status).toBe('backlog');
    });

    /**
     * The whole point of a list: reaching past the last decision. Entries describe one unit each, so
     * they do not overlap and taking one back says nothing about the ones above it.
     */
    it('takes back a decision from further up the list, leaving the rest decided', async () => {
      service.decide('kept'); // a
      service.decide('rejected'); // b
      await Promise.resolve();

      await service.undo(service.recentDecisions()[1]); // the older of the two

      const byId = new Map(photos().map((p) => [p.id, p.status]));
      expect(byId.get('a')).toBe('backlog');
      expect(byId.get('b')).toBe('rejected');
      expect(service.recentDecisions()).toHaveLength(1);
    });

    it('brings the photo it took back to the cursor, so it is judged next', async () => {
      service.decide('kept'); // a
      service.decide('rejected'); // b
      await Promise.resolve();

      await service.undo(service.recentDecisions()[1]); // 'a', two photos ago

      expect(photos()[index()].id).toBe('a');
    });

    it('ignores an entry that has already been taken back', async () => {
      service.decide('kept');
      await Promise.resolve();
      const entry = service.recentDecisions()[0];

      await service.undo(entry);
      await service.undo(entry);

      expect(photos()[0].status).toBe('backlog');
      expect(service.recentDecisions()).toEqual([]);
    });
  });

  it('toggleStar() flips the star without advancing', () => {
    service.toggleStar();
    expect((photos()[0] as Photo).starred).toBe(true);
    expect(index()).toBe(0);
  });

  it('resolveBurst() keeps the winner, rejects the rest, and marks the unit done', async () => {
    photos.set([burst('grp', ['f1', 'f2', 'f3'])]);
    index.set(0);
    service.resolveBurst(['f2']);
    await Promise.resolve();
    expect(photos()[0].status).toBe('kept'); // the burst unit itself is done
    expect(verdicts).toContainEqual({
      id: 'f2',
      verdict: { status: 'kept', starred: false, saveOnly: false },
    });
    expect(verdicts).toContainEqual({
      id: 'f1',
      verdict: { status: 'rejected', starred: false, saveOnly: false },
    });
    expect(verdicts).toContainEqual({
      id: 'f3',
      verdict: { status: 'rejected', starred: false, saveOnly: false },
    });
  });

  it('resolveBurst() keeps every frame the duel kept, not just one', async () => {
    // A burst can hold two frames worth keeping — the pair where nobody lost.
    photos.set([burst('grp', ['f1', 'f2', 'f3'])]);
    index.set(0);

    service.resolveBurst(['f1', 'f3']);
    await Promise.resolve();

    expect(photos()[0].status).toBe('kept');
    expect(verdicts).toContainEqual({
      id: 'f1',
      verdict: { status: 'kept', starred: false, saveOnly: false },
    });
    expect(verdicts).toContainEqual({
      id: 'f3',
      verdict: { status: 'kept', starred: false, saveOnly: false },
    });
    expect(verdicts).toContainEqual({
      id: 'f2',
      verdict: { status: 'rejected', starred: false, saveOnly: false },
    });
  });

  it('resolveBurst() marks the unit rejected when the answer was "none of them"', async () => {
    // Otherwise a burst nobody kept would count in the day's tally as one that was kept.
    photos.set([burst('grp', ['f1', 'f2'])]);
    index.set(0);

    service.resolveBurst([]);
    await Promise.resolve();

    expect(photos()[0].status).toBe('rejected');
    expect(verdicts.map((v) => v.verdict.status)).toEqual(['rejected', 'rejected', 'rejected']);
  });

  it('markBurstAsPano() re-types the unit in place and records the reclassify', () => {
    photos.set([burst('grp', ['f1', 'f2'])]);
    index.set(0);
    service.markBurstAsPano();
    const unit = photos()[0] as Pano;
    expect(unit.kind).toBe('pano');
    expect(unit.frames.map((f) => f.id)).toEqual(['f1', 'f2']);
    expect(reclassifies.length).toBe(1);
    expect(reclassifies[0]).toMatchObject({
      memberIds: ['f1', 'f2'],
      type: 'pano',
      orientation: 'horizontal',
    });
  });

  it('never stores device photos in the day, since loadToday re-appends them on every load', () => {
    const device: Photo = { ...photo('dev1'), source: 'device' };
    photos.set([burst('grp', ['f1', 'f2']), device]);
    index.set(0);

    service.markBurstAsPano(); // any edit to the deck re-persists it

    expect(photos().map((p) => p.id)).toEqual(['pano:grp', 'dev1']); // still on screen
    expect(dailyFeeds.get(todayKey())?.map((p) => p.id)).toEqual(['pano:grp']); // but not stored
  });

  describe('resolveIncompletePair()', () => {
    const incomplete = (id: string, frameId: string): ReviewItem => ({
      id,
      name: 'Stereo pair · right eye missing',
      album: 'Iceland L',
      taken: '2026-01-01',
      status: 'backlog',
      kind: 'stereo',
      left: [{ id: frameId, name: frameId }],
      baselines: [{ key: 'b0', label: 'incomplete pair', hint: '1 frame', frames: [] }],
      gap: {
        missing: 'right',
        foundIn: { name: 'Iceland L', id: 'al-l' },
        expectedIn: { name: 'Iceland R', id: 'al-r' },
      },
    });

    // The frame, not just the unit. An incomplete pair's id is synthetic, so a verdict stored only
    // under it would leave the photograph itself in the backlog — and it would come back tomorrow
    // under a new unit id, which is exactly the trap "skip" already is.
    it('records the verdict against the frame, so the photograph is actually settled', () => {
      photos.set([incomplete('stereo-gap:f1', 'f1'), photo('b')]);

      service.resolveIncompletePair('kept');

      expect(verdicts.filter((v) => v.id === 'f1').map((v) => v.verdict.status)).toEqual(['kept']);
      expect(photos()[0].status).toBe('kept');
    });

    it('rejects the frame the same way, so a half nobody wants also leaves the deck', () => {
      photos.set([incomplete('stereo-gap:f1', 'f1'), photo('b')]);

      service.resolveIncompletePair('rejected');

      expect(verdicts.filter((v) => v.id === 'f1').map((v) => v.verdict.status)).toEqual([
        'rejected',
      ]);
    });

    it('does nothing on a whole pair, which is judged per baseline instead', () => {
      photos.set([photo('a')]);

      service.resolveIncompletePair('kept');

      expect(photos()[0].status).toBe('backlog');
    });
  });

  describe('withdrawCurrentUnit()', () => {
    // What "Skip for now" does on a stereo pair that is missing an eye. No verdict may be recorded:
    // one would keep the frame out of every later selection, so the shot could never be shown whole
    // once the albums are paired up properly.
    it('drops the unit at the cursor without recording a verdict', () => {
      photos.set([photo('a'), photo('b'), photo('c')]);
      index.set(1);

      service.withdrawCurrentUnit();

      expect(photos().map((p) => p.id)).toEqual(['a', 'c']);
      expect(verdicts).toEqual([]);
      expect(dailyFeeds.get(todayKey())?.map((p) => p.id)).toEqual(['a', 'c']);
    });
  });

  describe('withdrawAlbum()', () => {
    const inAlbum = (id: string, album: string, status: Photo['status'] = 'backlog'): Photo => ({
      ...photo(id, status),
      album,
    });

    it("removes the album's undecided units and persists the shortened day", () => {
      photos.set([inAlbum('a', 'Houten'), photo('b'), inAlbum('c', 'Houten')]);
      index.set(1);

      service.withdrawAlbum('Houten');

      expect(photos().map((p) => p.id)).toEqual(['b']);
      expect(dailyFeeds.get(todayKey())?.map((p) => p.id)).toEqual(['b']);
    });

    it('keeps units the user already decided on, so no verdict is silently discarded', () => {
      photos.set([inAlbum('a', 'Houten', 'kept'), inAlbum('b', 'Houten'), photo('c')]);

      service.withdrawAlbum('Houten');

      expect(photos().map((p) => p.id)).toEqual(['a', 'c']);
    });

    it('leaves other albums alone', () => {
      photos.set([inAlbum('a', 'Houten'), inAlbum('b', 'Lisbon')]);

      service.withdrawAlbum('Houten');

      expect(photos().map((p) => p.id)).toEqual(['b']);
    });

    it('holds the cursor on the unit being viewed when it survives', () => {
      photos.set([inAlbum('a', 'Houten'), photo('b'), photo('c')]);
      index.set(2); // looking at 'c'

      service.withdrawAlbum('Houten');

      expect(photos()[index()].id).toBe('c');
    });

    it('falls to the next undecided unit when the viewed one is withdrawn', () => {
      photos.set([photo('a', 'kept'), inAlbum('b', 'Houten'), photo('c')]);
      index.set(1); // looking at the unit about to go

      service.withdrawAlbum('Houten');

      expect(photos()[index()].id).toBe('c');
    });

    it('does nothing when the album has no undecided units in the deck', () => {
      photos.set([photo('a'), photo('b')]);

      service.withdrawAlbum('Houten');

      expect(photos().map((p) => p.id)).toEqual(['a', 'b']);
      expect(dailyFeeds.has(todayKey())).toBe(false); // no pointless write
    });
  });

  it('re-typing back and forth returns the original id instead of stacking prefixes', () => {
    photos.set([burst('burst:alb1:f1', ['f1', 'f2'])]);
    index.set(0);

    service.markBurstAsPano();
    expect(photos()[0].id).toBe('pano:alb1:f1');

    service.markPanoAsBurst();
    expect(photos()[0].id).toBe('burst:alb1:f1'); // the id it started from, not burst:pano:burst:…
  });

  describe('setPanoFrames() — "photos are missing"', () => {
    it('takes the frames the user confirmed, and re-titles the card from the new count', async () => {
      photos.set([pano('pano:alb1:f2', ['f2', 'f3'])]);
      index.set(0);

      service.setPanoFrames([
        { id: 'f1', name: 'DSC_1' },
        { id: 'f2', name: 'DSC_2' },
        { id: 'f3', name: 'DSC_3' },
      ]);
      await Promise.resolve();

      const updated = photos()[0] as Pano;
      expect(updated.frames.map((f) => f.id)).toEqual(['f1', 'f2', 'f3']);
      expect(updated.name).toBe('Panorama · 3 frames');
    });

    it('records the correction against the frames detection found, so a re-scan re-applies it', async () => {
      photos.set([pano('pano:alb1:f2', ['f2', 'f3'])]);
      index.set(0);

      service.setPanoFrames([
        { id: 'f1', name: 'DSC_1' },
        { id: 'f2', name: 'DSC_2' },
        { id: 'f3', name: 'DSC_3' },
      ]);
      await Promise.resolve();

      expect(memberships).toEqual([
        expect.objectContaining({ memberIds: ['f2', 'f3'], frameIds: ['f1', 'f2', 'f3'] }),
      ]);
      expect(dailyFeeds.get(todayKey())?.length).toBe(1); // survives a reload too
    });

    it('takes the sibling pano off the deck when its frames are merged in', async () => {
      // The real case: one sweep detected as two panos. Left on the deck, the same photographs
      // would stand there twice, each asking for its own verdict.
      photos.set([pano('pano:alb1:f1', ['f1', 'f2']), pano('pano:alb1:f3', ['f3', 'f4'])]);
      index.set(0);

      service.setPanoFrames([
        { id: 'f1', name: 'DSC_1' },
        { id: 'f2', name: 'DSC_2' },
        { id: 'f3', name: 'DSC_3' },
        { id: 'f4', name: 'DSC_4' },
      ]);
      await Promise.resolve();

      expect(photos()).toHaveLength(1);
      expect((photos()[0] as Pano).frames.map((f) => f.id)).toEqual(['f1', 'f2', 'f3', 'f4']);
    });

    it('dissolves the absorbed group, so the next scan does not split the sweep again', async () => {
      photos.set([pano('pano:alb1:f1', ['f1', 'f2']), pano('pano:alb1:f3', ['f3', 'f4'])]);
      index.set(0);

      service.setPanoFrames([
        { id: 'f1', name: 'DSC_1' },
        { id: 'f2', name: 'DSC_2' },
        { id: 'f3', name: 'DSC_3' },
        { id: 'f4', name: 'DSC_4' },
      ]);
      await Promise.resolve();

      expect(dissolves).toEqual([expect.objectContaining({ memberIds: ['f3', 'f4'] })]);
      expect(memberships).toEqual([
        expect.objectContaining({ memberIds: ['f1', 'f2'], frameIds: ['f1', 'f2', 'f3', 'f4'] }),
      ]);
    });

    it('drops a single whose photo the sweep has taken, without recording a group correction', async () => {
      photos.set([pano('pano:alb1:f1', ['f1', 'f2']), photo('f3')]);
      index.set(0);

      service.setPanoFrames([
        { id: 'f1', name: 'DSC_1' },
        { id: 'f2', name: 'DSC_2' },
        { id: 'f3', name: 'DSC_3' },
      ]);
      await Promise.resolve();

      expect(photos()).toHaveLength(1); // the single is part of the sweep now
      expect(dissolves).toEqual([]); // a photo is not a group; there is nothing to dissolve
    });

    it('ignores a set too small to be a panorama at all', () => {
      photos.set([pano('pano:alb1:f2', ['f2', 'f3'])]);
      index.set(0);

      service.setPanoFrames([{ id: 'f2', name: 'DSC_2' }]);

      expect((photos()[0] as Pano).frames).toHaveLength(2);
      expect(memberships).toEqual([]);
    });

    it('leaves anything that is not a pano alone', () => {
      service.setPanoFrames([
        { id: 'x', name: 'x' },
        { id: 'y', name: 'y' },
      ]);

      expect(memberships).toEqual([]);
    });
  });

  it('promoteToPrint() marks the photo toPrint and bumps the edit count', () => {
    service.promoteToPrint('a');
    expect(photos()[0].status).toBe('toPrint');
    expect(service.editedToday()).toBe(1);
  });

  it('fires the goal celebration once the day count reaches the goal', async () => {
    TestBed.resetTestingModule(); // re-provision with a reachable goal of 1
    photos = signal<ReviewItem[]>([photo('a'), photo('b')]);
    index = signal(0);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ReviewFeedService,
          useValue: {
            photos,
            index,
            loaded: signal(true),
            current: () => photos()[index()],
            advance: () => index.update((i) => i + 1),
            back: () => {},
          },
        },
        {
          provide: ReviewStore,
          useValue: {
            setVerdict: () => Promise.resolve(),
            removeVerdict: () => Promise.resolve(),
            loadedVerdicts: () => new Map<string, StoredVerdict>(),
          },
        },
        { provide: GroupOverrideStore, useValue: {} },
        { provide: BackgroundScanService, useValue: { scheduleRefill: () => {} } },
        {
          provide: PreferencesService,
          useValue: { dailyGoal: () => 1, editGoal: () => 3, tagGoal: () => 15 },
        },
      ],
    });
    service = TestBed.inject(ReviewDecisionsService);
    service.bindAuth(() => true);

    service.decide('kept'); // 1 done, goal is 1
    await Promise.resolve();
    TestBed.tick(); // the celebration is raised by an effect watching the day's tally
    expect(service.celebration()?.title).toContain('daily goal done');
    expect(localStorage.getItem('celebratedGoal')).toBe(todayKey());
  });
});
