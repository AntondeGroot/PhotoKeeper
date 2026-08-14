import { Injectable, signal } from '@angular/core';

/** The slice of the native BatteryOptimization plugin this app uses, as the bridge exposes it. */
interface BatteryOptimizationPlugin {
  isIgnoring(): Promise<{ ignoring: boolean }>;
  request(): Promise<{ ignoring: boolean }>;
}

interface CapacitorBridge {
  Plugins?: { BatteryOptimization?: BatteryOptimizationPlugin };
}

/**
 * Whether Android will let the app run in the background, and the ask if it will not.
 *
 * Read off the injected Capacitor bridge rather than imported, for the same reason the reminder
 * adapter is: one bundle is served to both the native shell and plain browsers, and on the web
 * there is nothing to talk to.
 *
 * The state is worth surfacing even when nothing can be done about it. Doze silently defers the
 * daily reminders of an app it considers idle — which is exactly what this one is between sessions
 * — so "the reminder never arrived" has at least two explanations, and this separates them.
 */
@Injectable({ providedIn: 'root' })
export class BatteryOptimizationService {
  /** null while unknown, or on the web where the question does not apply. */
  readonly exempt = signal<boolean | null>(null);

  /** True in the native shell, where the setting exists and can be asked for. */
  get available(): boolean {
    return this.plugin() !== null;
  }

  async refresh(): Promise<void> {
    const plugin = this.plugin();
    if (!plugin) return;
    try {
      this.exempt.set((await plugin.isIgnoring()).ignoring);
    } catch {
      this.exempt.set(null); // unknown beats claiming it is restricted
    }
  }

  /**
   * Raises the system dialog. The answer arrives as a settings change rather than a result, so the
   * state is re-read when the app returns to the foreground.
   */
  async request(): Promise<void> {
    const plugin = this.plugin();
    if (!plugin) return;
    try {
      await plugin.request();
    } catch {
      // Declining, or no activity to show it — the state simply stays as it was.
    }
    await this.refresh();
  }

  private plugin(): BatteryOptimizationPlugin | null {
    const bridge = (globalThis as { Capacitor?: CapacitorBridge }).Capacitor;
    return bridge?.Plugins?.BatteryOptimization ?? null;
  }
}
