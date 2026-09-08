import { Injectable } from '@angular/core';

/** The connection kinds Android reports, as @capacitor/network names them. */
export type ConnectionType = 'wifi' | 'cellular' | 'none' | 'unknown';

interface ListenerHandle {
  remove(): Promise<void>;
}

/** The slice of @capacitor/network this app uses, as the native bridge exposes it. */
interface NetworkPlugin {
  getStatus(): Promise<{ connectionType: ConnectionType }>;
  addListener(
    eventName: 'networkStatusChange',
    listener: (status: { connectionType: ConnectionType }) => void,
  ): Promise<ListenerHandle>;
}

interface CapacitorBridge {
  Plugins?: { Network?: NetworkPlugin };
}

/**
 * The Network plugin if we're running inside the native shell, else null. Read off the bridge that
 * Capacitor injects into the webview rather than imported from `@capacitor/network` — the same
 * choice {@link localNotificationsPlugin} makes, and for the same reasons: the identical bundle is
 * served to plain browsers, and the frontend does not depend on the Capacitor packages at all (they
 * are declared in the *root* package.json, for `cap sync`, and CI installs only `frontend/`).
 */
function networkPlugin(): NetworkPlugin | null {
  const bridge = (globalThis as { Capacitor?: CapacitorBridge }).Capacitor;
  return bridge?.Plugins?.Network ?? null;
}

/**
 * The two things {@link NetworkService} asks of the device, behind a seam.
 *
 * The bridge is a global, so the only other way to stand it up in a test is to mock a module — which
 * turned out to apply or not depending on whether another spec in the same worker had imported
 * Capacitor first, and produced a suite that failed roughly one run in two. A class is stubbed by
 * providing a different one, every run, in any order.
 */
@Injectable({ providedIn: 'root' })
export class NetworkPlatform {
  /** Where we are now — 'unknown' in a plain browser, which has no answer and needs none. */
  async status(): Promise<ConnectionType> {
    const plugin = networkPlugin();
    return plugin ? (await plugin.getStatus()).connectionType : 'unknown';
  }

  onChange(handler: (connection: ConnectionType) => void): void {
    void networkPlugin()?.addListener('networkStatusChange', (status) =>
      handler(status.connectionType),
    );
  }
}
