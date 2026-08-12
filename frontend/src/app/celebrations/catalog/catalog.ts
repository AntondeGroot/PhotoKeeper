import { CelebrationImage } from '../celebration.types';
import { POOL_IMAGES } from './pool';
import { SPECIAL_DATE_IMAGES } from './special-dates';

/** The whole celebration catalog, aggregated from the per-family files. */
export const CELEBRATION_CATALOG: CelebrationImage[] = [...SPECIAL_DATE_IMAGES, ...POOL_IMAGES];
