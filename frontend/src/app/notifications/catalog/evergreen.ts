import { NotificationMessage } from '../notification-message';

/**
 * Evergreen nudges — the gentle "come sort a few" fillers, shown when nothing date- or stat-specific
 * applies. Keep them warm and never naggy; the cooldown stops the same one repeating too soon. Add a
 * message by appending an object here (the `id` must be unique across the whole catalog).
 */
export const EVERGREEN_MESSAGES: NotificationMessage[] = [
  {
    id: 'pile-cozy',
    type: 'evergreen',
    icon: '📷',
    title: 'Your backlog is getting cozy',
    text: "Sort today's batch in two minutes?",
    cooldownDays: 3,
  },
  {
    id: 'two-minute-sort',
    type: 'evergreen',
    icon: '⏳',
    title: 'Got two minutes?',
    text: 'A quick sort a day, keeps the backlog away.',
    cooldownDays: 3,
  },
  {
    id: 'fresh-eyes',
    type: 'evergreen',
    icon: '☕',
    title: 'Fresh eyes this morning?',
    text: 'A few keep-or-toss calls before the day gets going.',
    cooldownDays: 4,
  },
];
