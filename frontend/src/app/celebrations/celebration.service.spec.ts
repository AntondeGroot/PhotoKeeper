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

  it('persists a showing, so a spent guarantee cannot fire twice', async () => {
    const valentinesDay = { date: new Date('2026-02-14T09:00') };
    service.rng = () => 0.99; // a draw that would never land on valentine of its own accord

    const first = await service.pickAndRecord(valentinesDay);
    expect(first).toEqual({ id: 'valentine', src: 'celebrations/special-dates/valentine.webp' });

    // The claim has to survive the round trip through IndexedDB, not just live in memory.
    expect((await log.load())['valentine'].claims).toEqual(['2026']);

    // Same day, same context: the claim is spent, so the slot goes to the pool instead.
    expect((await service.pickAndRecord(valentinesDay))?.id).not.toBe('valentine');
  });
});
