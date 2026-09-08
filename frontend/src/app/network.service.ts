import { Injectable, inject, signal } from '@angular/core';
import { ConnectionType, NetworkPlatform } from './network-platform.service';
import { PreferencesService } from './preferences.service';

/**
 * Whether the app may spend the connection it is on.
 *
 * <p>A review session downloads a 2048px rendition per photograph — the one thing this app does that
 * can quietly cost someone money — so "Wi-Fi only" has to be answerable before each of those. The
 * small `api/...` calls are never gated: they are a few kilobytes, and an app that refused to read
 * its own catalogue on mobile data would simply look broken.
 *
 * <p>Native, because the web could not answer it. Before this plugin was added `navigator.connection`
 * reported `type: "unknown"` on the phone even on Wi-Fi — the WebView cannot read connectivity
 * without ACCESS_NETWORK_STATE, which the app did not hold. (The plugin's own manifest brings that
 * permission, so `navigator.connection.type` now answers too — an accident of this change, not
 * something to depend on: it is non-standard, absent in most browsers, and its `effectiveType`
 * sibling classifies *speed*, saying "4g" for a fast Wi-Fi connection just as readily.) The plugin
 * reads Android's own connectivity manager and reports every change, which is what this needs.
 *
 * <p>In a browser there is no such answer and none is needed: a desktop is not metered in the way a
 * phone is, and refusing to load a photograph there would be a restriction with no beneficiary.
 */
@Injectable({ providedIn: 'root' })
export class NetworkService {
  private readonly prefs = inject(PreferencesService);
  private readonly platform = inject(NetworkPlatform);

  /** The connection as Android reports it; 'unknown' until the first reading comes back. */
  readonly connection = signal<ConnectionType>('unknown');

  /**
   * Starts listening to Android's connectivity manager. Called once at bootstrap
   * ({@link appConfig}) rather than from the constructor: injecting a service should not begin
   * subscribing to the platform as a side effect of the first component that happens to need it.
   *
   * Nothing is asked about the platform first. A browser has no plugin to answer, so it reports
   * 'unknown' and nothing is ever held back — the same outcome as skipping this, without a branch
   * that would have to be right about whether Capacitor had finished injecting its bridge yet.
   */
  start(): void {
    void this.refresh();
    this.platform.onChange((connection) => this.connection.set(connection));
    // The case the listener misses: the phone changes network while the app is in the background —
    // which is exactly when someone leaves the house — and the event does not survive the pause. The
    // app came back believing it was still on Wi-Fi, and a stale 'wifi' is the dangerous direction:
    // it spends the data plan this setting was turned on to protect. Asking again on the way back in
    // is cheap and needs no further plugin.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.refresh();
    });
  }

  /** Asks the platform where we are now, and publishes the answer. */
  private async refresh(): Promise<void> {
    this.connection.set(await this.platform.status());
  }

  /**
   * Whether a rendition may be downloaded right now.
   *
   * Anything other than a known cellular connection is allowed. An unknown one is not treated as
   * metered: the reading has not come back yet, or the platform cannot say, and holding a review
   * session hostage to a value the app was never given would be the worse mistake of the two.
   */
  mayDownloadRenditions(): boolean {
    if (!this.prefs.wifiOnly()) return true;
    return this.connection() !== 'cellular';
  }

  /** Whether the setting is actively holding downloads back, so a screen can say so. */
  heldBackByWifiOnly(): boolean {
    return this.prefs.wifiOnly() && this.connection() === 'cellular';
  }
}
