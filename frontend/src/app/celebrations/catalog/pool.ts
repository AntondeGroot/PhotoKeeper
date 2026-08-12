import { CelebrationImage } from '../celebration.types';

/**
 * The general pool: shown at the end of a review session, chosen at random. Files live in
 * `public/celebrations/session-done/`, written by `tools/celebration-review/export_to_app.py`.
 *
 * A shared cooldown keeps the rotation from repeating itself within a week — with this many images
 * that is plenty to make it feel varied without any of them going stale.
 */
const COOLDOWN_DAYS = 7;

const filler = (name: string): CelebrationImage => ({
  id: name,
  file: `session-done/${name}.webp`,
  when: { always: true },
  cooldownDays: COOLDOWN_DAYS,
});

/**
 * Images with no trigger of their own — the everyday rotation.
 *
 * Several of these are really achievements waiting for an event to exist: `panorama`,
 * `telephoto`, `macro-shot`, `drone-flight`, `burst-mode` and `stereo-viewing` all describe a
 * specific thing the user did. They sit in the pool until the app emits the matching
 * {@link CelebrationEvent}; moving one is a two-line change to its entry, not a rewrite.
 */
const FILLERS = [
  'album-making',
  'archaeologist',
  'archive-shelf',
  'browsing-album',
  'burning-clutter',
  'burst-mode',
  'cheering',
  'cropping',
  'darkroom',
  'desk-work',
  'drone-flight',
  'excited',
  'field-photographer',
  'flexing',
  'framing',
  'frozen',
  'gallery-wall',
  'hauling-away',
  'hidden-photographer',
  'inspecting',
  'macro-shot',
  'map-reading',
  'ninja',
  'orchestrating',
  'photo-pile',
  'photographer',
  'retouching',
  'sleeping',
  'sparkler',
  'stacking-albums',
  'stargazing',
  'starstruck',
  'stereo-viewing',
  'sweeping-up',
  'telephoto',
  'thumbs-up',
  'treasured-photo',
  'vista',
  'well-travelled',
];

/**
 * Milestone images. These carry a `perThreshold` guarantee, so each listed number gets its own
 * moment rather than being lost in the shuffle, and the same image can fire again at the next one.
 *
 * The counters they read are supplied by the caller; one that isn't tracked yet simply never
 * matches, so an entry here is inert rather than wrong.
 */
const MILESTONES: CelebrationImage[] = [
  {
    id: 'photo-pile-cheer',
    file: 'session-done/photo-pile-cheer.webp',
    when: { counter: 'photosReviewed', every: 500 },
    guarantee: 'perThreshold',
  },
  {
    id: 'overwhelmed',
    file: 'session-done/overwhelmed.webp',
    when: { counter: 'photosDeleted', every: 250 },
    guarantee: 'perThreshold',
  },
  {
    id: 'editing',
    file: 'session-done/editing.webp',
    when: { counter: 'photosEdited', every: 100 },
    guarantee: 'perThreshold',
  },
  {
    // Every album placed is worth a moment — there will never be enough of them to wear thin.
    id: 'archive-king',
    file: 'session-done/archive-king.webp',
    when: { counter: 'albumsPrinted', every: 1 },
    guarantee: 'perThreshold',
  },
  {
    id: 'summit',
    file: 'session-done/summit.webp',
    when: { counter: 'streakDays', every: 7 },
    guarantee: 'perThreshold',
  },
  {
    // A year of daily reviewing deserves better than the same weekly picture. 365 rather than 364
    // precisely because it is *not* a multiple of 7: on day 365 the weekly image is still sitting
    // on its day-364 claim, so this one takes the slot uncontested.
    id: 'crowned',
    file: 'session-done/crowned.webp',
    when: { counter: 'streakDays', every: 365 },
    guarantee: 'perThreshold',
  },
];

export const POOL_IMAGES: CelebrationImage[] = [...FILLERS.map(filler), ...MILESTONES];
