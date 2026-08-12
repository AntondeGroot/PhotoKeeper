import { CelebrationImage } from '../celebration.types';

/**
 * Calendar-gated celebration images. Files live in `public/celebrations/special-dates/` and are
 * written by `tools/celebration-review/export_to_app.py` — the name here is the export name.
 *
 * Every entry guarantees `perYear`: a date that comes round once must not be left to a dice roll.
 * The claim is spent on the first slot that opens on the day, after which the image stays eligible
 * but competes in the pool like anything else. Miss the day entirely and that year's claim is
 * simply lost — strict, by design, which is also why no claim ever needs expiring.
 *
 * The seasons use recurring ranges that wrap the year end, so they are authored once rather than
 * per year (see `DateCondition`).
 */
export const SPECIAL_DATE_IMAGES: CelebrationImage[] = [
  {
    id: 'valentine',
    file: 'special-dates/valentine.webp',
    when: { date: { onDate: '14-02' } },
    guarantee: 'perYear',
  },
  {
    id: 'easter',
    file: 'special-dates/easter.webp',
    // Easter moves with the lunar calendar, so a pinned year is the only honest way to say it —
    // and it needs a new entry each year. Next few: 2027-03-28, 2028-04-16, 2029-04-01.
    when: { date: { onDate: '05-04-2026' } },
    guarantee: 'perYear',
  },
  {
    id: 'koningsdag-lion',
    file: 'session-done/crowned.webp',
    when: { date: { onDate: '27-04' } },
    guarantee: 'perYear',
  },
  {
    id: 'syttende-mai',
    file: 'special-dates/syttende-mai.webp',
    when: { date: { onDate: '17-05' } },
    guarantee: 'perYear',
  },
  {
    id: 'midsommar',
    file: 'special-dates/midsommar.webp',
    // Midsummer's Eve: the Friday between 19 and 25 June. A short range is close enough for a
    // picture, and avoids pinning a year.
    when: { date: { fromDate: '19-06', toDate: '25-06' } },
    guarantee: 'perYear',
  },
  {
    id: 'halloween',
    file: 'special-dates/halloween.webp',
    when: { date: { onDate: '31-10' } },
    guarantee: 'perYear',
  },
  {
    id: 'sinterklaas',
    file: 'special-dates/sinterklaas.webp',
    when: { date: { onDate: '05-12' } },
    guarantee: 'perYear',
  },
  {
    id: 'christmas-gifts',
    file: 'special-dates/christmas-gifts.webp',
    when: { date: { onDate: '25-12' } },
    guarantee: 'perYear',
  },
  {
    id: 'christmas-tree',
    file: 'special-dates/christmas-tree.webp',
    // The run-up, not the day — christmas-gifts owns the 25th.
    when: { date: { fromDate: '10-12', toDate: '24-12' } },
    guarantee: 'perYear',
    cooldownDays: 3,
  },
  {
    id: 'new-year',
    file: 'special-dates/new-year.webp',
    when: { date: { fromDate: '31-12', toDate: '02-01' } },
    guarantee: 'perYear',
  },
  {
    id: 'autumn',
    file: 'special-dates/autumn.webp',
    when: { date: { fromDate: '21-09', toDate: '20-12' } },
    cooldownDays: 3,
  },
  {
    id: 'winter',
    file: 'special-dates/winter.webp',
    // Wraps the year end — expressible because a recurring range that ends before it starts wraps.
    when: { date: { fromDate: '21-12', toDate: '20-03' } },
    cooldownDays: 3,
  },
];
