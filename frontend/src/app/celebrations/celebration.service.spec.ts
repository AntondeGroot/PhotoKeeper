import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { TestBed } from '@angular/core/testing';
import { CelebrationService } from './celebration.service';
import { CelebrationLogStore } from '../storage/celebrations/celebration-log-store';

describe('CelebrationService', () => {
  let service: CelebrationService;
  let log: CelebrationLogStore;

  beforeEach(() => {
    indexedDB = new IDBFactory(); // fresh, empty database per test
    TestBed.configureTestingModule({});
    service = TestBed.inject(CelebrationService);
    log = TestBed.inject(CelebrationLogStore);
  });

  it('keeps returning the same image for a session, and only records it once', async () => {
    const context = { date: new Date('2026-06-01T09:00') };

    const first = await service.pickAndRecord(context, 'reviewed:209');
    // Leaving the tab and coming back rebuilds the component, so this is the revisit.
    const again = await service.pickAndRecord(context, 'reviewed:209');
    expect(again).toEqual(first);

    // Re-recording would burn the cooldown and spend guarantee claims on a mere page visit.
    expect((await log.load())[first!.id].count).toBe(1);

    // Reviewing more photos moves the key, which is what earns a fresh draw and a second entry in
    // the log. Summing counts covers both outcomes — a different image, or the same one twice.
    await service.pickAndRecord(context, 'reviewed:220');
    const showings = Object.values(await log.load()).reduce((sum, r) => sum + r.count, 0);
    expect(showings).toBe(2);
  });

  it('shows the same image again after a restart, without recording it twice', async () => {
    const context = { date: new Date('2026-06-01T09:00') };
    const first = await service.pickAndRecord(context, 'reviewed:209');

    // A cold start: the service is rebuilt and its in-memory memo is gone, but the database is the
    // same one the phone would come back to.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const restarted = TestBed.inject(CelebrationService);
    restarted.rng = () => 0.01; // a draw that would almost certainly choose differently

    expect(await restarted.pickAndRecord(context, 'reviewed:209')).toEqual(first);

    const showings = Object.values(await TestBed.inject(CelebrationLogStore).load()).reduce(
      (sum, r) => sum + r.count,
      0,
    );
    expect(showings).toBe(1);
  });

  it('persists a showing, so a spent guarantee cannot fire twice', async () => {
    const valentinesDay = { date: new Date('2026-02-14T09:00') };
    service.rng = () => 0.99; // a draw that would never land on valentine of its own accord

    const first = await service.pickAndRecord(valentinesDay, 'reviewed:10');
    expect(first).toEqual({ id: 'valentine', src: 'celebrations/special-dates/valentine.webp' });

    // The claim has to survive the round trip through IndexedDB, not just live in memory.
    expect((await log.load())['valentine'].claims).toEqual(['2026']);

    // A later session on the same day: the claim is spent, so the slot goes to the pool instead.
    expect((await service.pickAndRecord(valentinesDay, 'reviewed:25'))?.id).not.toBe('valentine');
  });
});
