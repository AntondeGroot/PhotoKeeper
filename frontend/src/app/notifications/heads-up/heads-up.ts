import { ChangeDetectionStrategy, Component, effect, input, output, signal } from '@angular/core';

/** One in-app celebration: a small positive heads-up shown the moment a win happens. */
export interface HeadsUp {
  icon: string; // a glyph/emoji shown in the badge
  title: string;
  text: string;
}

/** How long the banner holds on screen before it tucks away. */
const HOLD_MS = 3400;
/** Slide-out duration before the parent is told to clear the message (matches the CSS transition). */
const OUT_MS = 600;

/**
 * The in-app celebration banner: slides in from the top over the app, holds a moment, then tucks away.
 * Strictly for *celebrations* — earned, in-the-moment wins (daily goal hit, streak extended) — never
 * asks; nudges are the OS notification's job. A new {@link message} object triggers the animation; the
 * banner clears itself after the hold (or on tap) and emits {@link dismissed} so the parent resets.
 */
@Component({
  selector: 'app-heads-up',
  templateUrl: './heads-up.html',
  styleUrl: './heads-up.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeadsUpComponent {
  /** The current celebration, or null when nothing is showing. A new object re-fires the animation. */
  readonly message = input<HeadsUp | null>(null);
  /** Emitted once the banner has fully tucked away, so the parent can clear {@link message}. */
  readonly dismissed = output<void>();

  /** Whether the banner is in its on-screen (slid-in) state. */
  protected readonly shown = signal(false);

  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor() {
    effect(() => {
      const msg = this.message();
      this.clearTimers();
      if (!msg) {
        this.shown.set(false);
        return;
      }
      // Two frames so the off-screen start state paints before the slide-in transition begins.
      this.shown.set(false);
      requestAnimationFrame(() => requestAnimationFrame(() => this.shown.set(true)));
      this.timers.push(setTimeout(() => this.shown.set(false), HOLD_MS));
      this.timers.push(setTimeout(() => this.dismissed.emit(), HOLD_MS + OUT_MS));
    });
  }

  /** Tap to tuck it away early. */
  protected dismiss(): void {
    this.clearTimers();
    this.shown.set(false);
    this.timers.push(setTimeout(() => this.dismissed.emit(), OUT_MS));
  }

  private clearTimers(): void {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }
}
