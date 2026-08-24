import { NotificationMessage } from '../notification-message';

/**
 * Statistics-driven nudges — fired by your review numbers, with {{vars}} filled from the live stats
 * (pileCount, streak, editQueue, printsArrived). Conditions come from a fixed vocabulary (see
 * StatCondition). Add one by appending an object here.
 */
export const STAT_MESSAGES: NotificationMessage[] = [
  {
    id: 'streak-milestone',
    type: 'stat',
    icon: '🔥',
    stat: { streakReaches: [7, 14, 30, 100] },
    title: 'Day {{streak}} — nice streak',
    text: '{{pileCount}} photos are waiting for a quick sort.',
    cooldownDays: 1,
  },
  {
    id: 'edit-queue-deep',
    type: 'stat',
    icon: '🎚️',
    stat: { editQueueAtLeast: 6 },
    title: 'Your edit queue is filling up',
    text: '{{editQueue}} waiting — knock out a few today?',
    cooldownDays: 3,
    opensAt: 'edit',
  },
  {
    id: 'prints-arrived',
    type: 'stat',
    icon: '🖼️',
    stat: { printsAwaiting: true },
    title: 'Print day',
    text: 'Your prints arrived — ready to fill the album?',
    priority: 4, // a real-world arrival outranks even a date theme
    cooldownDays: 1,
    opensAt: 'prints',
  },
];
