import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Output,
  computed,
  effect,
  input,
  signal,
} from '@angular/core';

/** What the splash is communicating while the app boots. */
export type SplashState = 'normal' | 'offline' | 'update' | 'forced';

/** How long the developed wordmark holds before a non-normal state reveals its notice. */
const NOTICE_DELAY_MS = 1150;

/**
 * The launch screen: a darkroom "print" develops, the wordmark resolves, and — for the rare cases that
 * need it — a soft notice rises in its place. `normal` just develops and the host swaps to the app once
 * loading finishes. `offline`/`update` never block (they offer Continue/Later → `continued`); only
 * `forced` is a hard stop with no way past but Update. The animation honours prefers-reduced-motion.
 */
@Component({
  selector: 'app-splash',
  templateUrl: './splash.html',
  styleUrl: './splash.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SplashComponent {
  readonly state = input<SplashState>('normal');

  /** Dismiss a non-blocking notice and proceed into the app (offline Continue / update Later). */
  @Output() continued = new EventEmitter<void>();
  /** The user chose to update — the host opens the store / triggers the update. */
  @Output() updateRequested = new EventEmitter<void>();

  /** Mark has finished developing and the wordmark has resolved. */
  protected readonly developed = signal(false);
  /** A non-normal state's notice has risen in place of the wordmark. */
  protected readonly noticeVisible = signal(false);
  /** Offline "don't remind me" toggle (local to the splash; the host decides what to persist). */
  protected readonly dontRemind = signal(false);

  /** The forced-update state dims the print behind its hard-stop notice. */
  protected readonly markDimmed = computed(() => this.noticeVisible() && this.state() === 'forced');

  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Re-run the develop→reveal→notice timeline whenever the state changes (states are visual-only for
    // now, but this keeps the animation correct if the host swaps state live).
    effect(() => {
      const state = this.state();
      this.developed.set(false);
      this.noticeVisible.set(false);
      if (this.timer) clearTimeout(this.timer);

      // Two frames so the "undeveloped" start state paints before the transition to developed begins.
      requestAnimationFrame(() => requestAnimationFrame(() => this.developed.set(true)));

      if (state !== 'normal') {
        this.timer = setTimeout(() => this.noticeVisible.set(true), NOTICE_DELAY_MS);
      }
    });
  }

  protected toggleDontRemind(): void {
    this.dontRemind.update((on) => !on);
  }
}
