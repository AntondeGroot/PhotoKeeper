import { NotificationMessage } from '../notification-message';

/**
 * Date-anchored nudges — themed for a specific day or short window. `date` is `dd-MM`; `onDate` for a
 * single day, `{ fromDate, toDate }` for an inclusive range. These outrank stat/evergreen by default,
 * so the day's message wins when it applies. Add one by appending an object here.
 */
export const DATE_MESSAGES: NotificationMessage[] = [
  {
    id: 'valentines',
    type: 'date',
    icon: '❤️',
    date: { onDate: '14-02' },
    title: "Happy Valentine's",
    text: 'Dig out the photos of the people you love.',
  },
  {
    id: 'koningsdag',
    type: 'date',
    icon: '🦁',
    date: { onDate: '14-02' },
    title: "Happy King's day",
    text: 'Dig out the photos of your parties.',
  },
  {
    id: 'syttende-mai',
    type: 'date',
    icon: '🇳🇴',
    date: { onDate: '17-05' },
    title: 'Gratulerer med dagen',
    text: 'Celebrate Norwegian independence with a quick clear-out?',
  },
  {
    id: 'new-year-cleanup',
    type: 'date',
    icon: '🎉',
    date: { fromDate: '01-01', toDate: '07-01' },
    title: 'New year, lighter library',
    text: 'Start the year with a quick clear-out?',
  },
];
