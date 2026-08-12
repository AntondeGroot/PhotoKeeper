import { pickCelebration, recordShown } from './celebration-picker';
import { CelebrationContext, CelebrationImage, ShownLog } from './celebration.types';

const valentine: CelebrationImage = {
  id: 'valentine',
  file: 'special-dates/valentine.webp',
  when: { date: { onDate: '14-02' } },
  guarantee: 'perYear',
};

const winter: CelebrationImage = {
  id: 'winter',
  file: 'special-dates/winter.webp',
  when: { date: { fromDate: '21-12', toDate: '20-03' } },
};

const filler: CelebrationImage = {
  id: 'thumbs-up',
  file: 'session-done/thumbs-up.webp',
  when: { always: true },
};

const deletionMilestone: CelebrationImage = {
  id: 'overwhelmed',
  file: 'session-done/overwhelmed.webp',
  when: { counter: 'photosDeleted', reaches: [50, 100] },
  guarantee: 'perThreshold',
};

const existingWinterRecord = { lastShown: 1, count: 3, claims: [] };

const on = (iso: string): CelebrationContext => ({ date: new Date(iso) });

const afterDeleting = (n: number): CelebrationContext => ({
  date: new Date('2026-06-01T09:00'),
  counters: { photosDeleted: n },
});

describe('pickCelebration', () => {
  it('drops an image back into the pool once its claim is spent', () => {
    const catalog = [valentine, winter];
    const context = on('2026-02-14T09:00');

    // First slot of the day: the claim is unspent, so it wins outright however the dice fall.
    const first = pickCelebration(catalog, context, {}, () => 0.99);
    expect(first?.id).toBe('valentine');

    // Having spent it, valentine no longer *claims* the slot — but it is still eligible, so a
    // draw that lands on it is fine. What must not happen is it being forced again.
    const log: ShownLog = recordShown(first!, context, {});
    expect(pickCelebration(catalog, context, log, () => 0.99)?.id).toBe('winter');
    expect(pickCelebration(catalog, context, log, () => 0)?.id).toBe('valentine');
  });

  it('prefers the narrower claimant when two images both guarantee', () => {
    const day: CelebrationImage = {
      id: 'christmas-eve',
      file: 'special-dates/christmas-eve.webp',
      when: { date: { onDate: '24-12' } },
      guarantee: 'perYear',
    };
    const runUp: CelebrationImage = {
      id: 'christmas-tree',
      file: 'special-dates/christmas-tree.webp',
      when: { date: { fromDate: '10-12', toDate: '24-12' } },
      guarantee: 'perYear',
    };
    const christmasEve = on('2026-12-24T09:00');

    // Both claim the slot; the one true day beats the fortnight, whichever order they sit in.
    expect(pickCelebration([runUp, day], christmasEve, {}, () => 0.99)?.id).toBe('christmas-eve');
    expect(pickCelebration([day, runUp], christmasEve, {}, () => 0)?.id).toBe('christmas-eve');
  });

  it('holds an image out for its cooldown, then lets it back in', () => {
    const rested: CelebrationImage = { ...filler, id: 'rested', cooldownDays: 7 };
    const catalog = [rested];
    const shownOn = on('2026-06-01T09:00');

    const log = recordShown(rested, shownOn, {});
    // Nothing else is eligible, so a null pick is the cooldown talking, not a lost draw.
    expect(pickCelebration(catalog, on('2026-06-07T09:00'), log)).toBeNull();
    expect(pickCelebration(catalog, on('2026-06-08T09:00'), log)?.id).toBe('rested');
  });

  it('keeps firing an "every N" milestone, once per interval, without end', () => {
    const everyHundred: CelebrationImage = {
      id: 'editing',
      file: 'session-done/editing.webp',
      when: { counter: 'photosEdited', every: 100 },
      guarantee: 'perThreshold',
    };
    const catalog = [everyHundred, filler];
    const afterEditing = (n: number): CelebrationContext => ({
      date: new Date('2026-06-01T09:00'),
      counters: { photosEdited: n },
    });

    // Below the first interval there is no milestone at all — 0 is not an achievement.
    expect(pickCelebration(catalog, afterEditing(40), {}, () => 0.99)?.id).toBe('thumbs-up');

    let log: ShownLog = {};
    for (const total of [100, 250, 1000, 12_400]) {
      const picked = pickCelebration(catalog, afterEditing(total), log, () => 0.99);
      expect(picked?.id).toBe('editing');
      log = recordShown(picked!, afterEditing(total), log);

      // ...then stays quiet for the rest of that hundred. Checked at the last total before the
      // next multiple, which is the closest a still-claimed interval ever gets to firing again.
      const lastOfInterval = Math.floor(total / 100) * 100 + 99;
      expect(pickCelebration(catalog, afterEditing(lastOfInterval), log, () => 0.99)?.id).toBe(
        'thumbs-up',
      );
    }
  });

  it('counts a milestone as reached even when the total jumped past it', () => {
    const catalog = [deletionMilestone, filler]; // rungs at 50 and 100

    // Totals are only read when a slot opens, and resolving a burst decides a dozen photos at
    // once, so landing exactly on 100 is luck. Crossing it has to be enough.
    const first = pickCelebration(catalog, afterDeleting(107), {}, () => 0.99);
    expect(first?.id).toBe('overwhelmed');

    // Still the same rung forty photos later: one milestone, one celebration — not one per photo.
    const log = recordShown(first!, afterDeleting(107), {});
    expect(pickCelebration(catalog, afterDeleting(140), log, () => 0.99)?.id).toBe('thumbs-up');
  });

  it('renews a perThreshold claim at the next milestone', () => {
    const catalog = [deletionMilestone, filler];

    const first = pickCelebration(catalog, afterDeleting(50), {}, () => 0.99);
    expect(first?.id).toBe('overwhelmed');

    // Same milestone again: the claim for *this* threshold is spent, so it stops forcing itself.
    const log = recordShown(first!, afterDeleting(50), {});
    expect(pickCelebration(catalog, afterDeleting(50), log, () => 0.99)?.id).toBe('thumbs-up');

    // The next milestone is a different occasion, so it claims the slot again off the same log.
    expect(pickCelebration(catalog, afterDeleting(100), log, () => 0.99)?.id).toBe('overwhelmed');
  });
});

describe('recordShown', () => {
  it('accumulates claims and counts without disturbing other images', () => {
    const first = recordShown(valentine, on('2026-02-14T09:00'), { winter: existingWinterRecord });
    expect(first['valentine']).toEqual({
      lastShown: new Date('2026-02-14T09:00').getTime(),
      count: 1,
      claims: ['2026'],
    });
    expect(first['winter']).toBe(existingWinterRecord); // untouched, same reference

    // A second showing the same day bumps the count but must not file the year's claim twice.
    const second = recordShown(valentine, on('2026-02-14T21:00'), first);
    expect(second['valentine'].count).toBe(2);
    expect(second['valentine'].claims).toEqual(['2026']);

    // Next year is a separate occasion, so its claim is added alongside — not replacing 2026.
    const third = recordShown(valentine, on('2027-02-14T09:00'), second);
    expect(third['valentine'].claims).toEqual(['2026', '2027']);
  });
});
