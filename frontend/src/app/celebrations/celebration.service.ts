import { Injectable, inject } from '@angular/core';
import { CelebrationLogStore } from '../storage/celebrations/celebration-log-store';
import { CELEBRATION_CATALOG } from './catalog/catalog';
import { CelebrationContext, PickedCelebration } from './celebration.types';
import { pickCelebration, recordShown } from './celebration-picker';

/** Where the exported artwork is served from (see `public/celebrations/`). */
const IMAGE_BASE = 'celebrations/';

/**
 * Chooses the celebration image to show and remembers that it was shown.
 *
 * Pure selection lives in `celebration-picker.ts`; this owns the side effects — reading the log,
 * persisting the result — mirroring how {@link NotificationService} sits over the notification
 * picker.
 *
 * Recording happens at pick time rather than after display, deliberately. The caller is about to
 * show the image, so it *has* been used up; and a guarantee claim that isn't spent immediately
 * would be claimed again by the next slot that opens the same day, which is precisely the repeat
 * the claim exists to prevent.
 */
@Injectable({ providedIn: 'root' })
export class CelebrationService {
  private readonly log = inject(CelebrationLogStore);

  /** Random source for the pool draw — overridable in tests for determinism. */
  rng: () => number = Math.random;

  /**
   * Picks the image that fits `context`, records it, and returns it ready to display.
   * Null when nothing qualifies — every candidate is out of season, or resting on a cooldown.
   */
  async pickAndRecord(context: CelebrationContext): Promise<PickedCelebration | null> {
    const shown = await this.log.load();
    const image = pickCelebration(CELEBRATION_CATALOG, context, shown, this.rng);
    if (!image) return null;

    const updated = recordShown(image, context, shown);
    await this.log.put(image.id, updated[image.id]);

    return { id: image.id, src: IMAGE_BASE + image.file };
  }
}
