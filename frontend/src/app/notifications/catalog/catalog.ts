import { NotificationMessage } from '../notification-message';
import { EVERGREEN_MESSAGES } from './evergreen';
import { DATE_MESSAGES } from './dates';
import { STAT_MESSAGES } from './stats';

/** The whole notification catalog, aggregated from the per-type files. */
export const CATALOG: NotificationMessage[] = [
  ...EVERGREEN_MESSAGES,
  ...DATE_MESSAGES,
  ...STAT_MESSAGES,
];
