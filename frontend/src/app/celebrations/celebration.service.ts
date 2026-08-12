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

  /** The last pick and the session it belongs to, so revisiting that session is not a re-roll. */
  private lastPick: { sessionKey: string; picked: PickedCelebration | null } | null = null;

  /**
   * Picks the image that fits `context`, records it, and returns it ready to display.
   * Null when nothing qualifies — every candidate is out of season, or resting on a cooldown.
   *
   * `sessionKey` identifies the occasion being celebrated. Asked again for the same key, this
   * returns the same image without re-picking or re-recording: leaving the tab and coming back
   * should not be a fresh draw. Recording again would be worse than cosmetic — it burns cooldowns
   * and spends guarantee claims, so a second look at Valentine's day would find the claim already
   * gone and quietly show something else.
   */
  async pickAndRecord(
    context: CelebrationContext,
    sessionKey: string,
  ): Promise<PickedCelebration | null> {
    if (this.lastPick?.sessionKey === sessionKey) return this.lastPick.picked;

    const restored = await this.restore(sessionKey);
    if (restored !== undefined) {
      this.lastPick = { sessionKey, picked: restored };
      return restored;
    }

    const shown = await this.log.load();
    const image = pickCelebration(CELEBRATION_CATALOG, context, shown, this.rng);
    const picked = image ? { id: image.id, src: IMAGE_BASE + image.file } : null;

    if (image) {
      const updated = recordShown(image, context, shown);
      await this.log.put(image.id, updated[image.id]);
    }
    await this.log.saveCurrent({ sessionKey, id: image?.id ?? null });
    this.lastPick = { sessionKey, picked };
    return picked;
  }

  /**
   * The stored pick for this session, re-resolved against the catalog — so closing the app and
   * reopening it shows the same picture rather than rolling again.
   *
   * `undefined` means there is nothing usable to restore (no record, a different session, or an id
   * the catalog no longer has) and a fresh pick should be made. That is deliberately distinct from
   * `null`, which is a recorded "this session had no candidate" and must be honoured — otherwise a
   * restart retries a draw that has already come up empty.
   */
  private async restore(sessionKey: string): Promise<PickedCelebration | null | undefined> {
    const current = await this.log.loadCurrent();
    if (!current || current.sessionKey !== sessionKey) return undefined;
    if (current.id === null) return null;

    const image = CELEBRATION_CATALOG.find((entry) => entry.id === current.id);
    return image ? { id: image.id, src: IMAGE_BASE + image.file } : undefined;
  }
}
