import { Injectable, computed, inject, signal } from '@angular/core';
import { LightroomService } from '../lightroom.service';

/**
 * Whether the app should be asking the user to sign in to Lightroom again.
 *
 * Two things decide it, and they belong together: a session was lost (the service knows), and the
 * user has not waved the prompt away for this run. Kept out of the host component because it is a
 * question about the Lightroom source, not about the review screen the host otherwise runs.
 */
@Injectable({ providedIn: 'root' })
export class ReconnectPromptService {
  private readonly lightroom = inject(LightroomService);

  // For this run only. The session really is gone, so the prompt is owed again next launch;
  // Settings → Disconnect is how the user ends it for good.
  private readonly dismissed = signal(false);

  /** True while the reconnect screen should stand in place of the app. */
  readonly showing = computed(() => this.lightroom.sessionLost() && !this.dismissed());

  /**
   * "Continue without Lightroom" — stand the prompt down and fall through to the app, which for now
   * means whatever this device contributes. Nothing is cleared: the session is still lost.
   */
  dismiss(): void {
    this.dismissed.set(true);
  }
}
