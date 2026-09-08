import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { NetworkService } from './network.service';
import { ConnectionType, NetworkPlatform } from './network-platform.service';
import { PreferencesService } from './preferences.service';

describe('NetworkService', () => {
  /** The device, stood up as an object: what it reports, and what it was asked. */
  class FakePlatform implements NetworkPlatform {
    connection: ConnectionType = 'wifi';
    reads = 0;
    handler: ((connection: ConnectionType) => void) | null = null;

    status(): Promise<ConnectionType> {
      this.reads++;
      return Promise.resolve(this.connection);
    }

    onChange(handler: (connection: ConnectionType) => void): void {
      this.handler = handler;
    }
  }

  let platform: FakePlatform;

  function make(wifiOnly: boolean, connection: ConnectionType) {
    platform = new FakePlatform();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: PreferencesService, useValue: { wifiOnly: signal(wifiOnly) } },
        { provide: NetworkPlatform, useValue: platform },
      ],
    });
    const service = TestBed.inject(NetworkService);
    service.connection.set(connection);
    return service;
  }

  it('holds renditions back on mobile data when the setting is on', () => {
    expect(make(true, 'cellular').mayDownloadRenditions()).toBe(false);
  });

  it('allows them on Wi-Fi', () => {
    expect(make(true, 'wifi').mayDownloadRenditions()).toBe(true);
  });

  it('allows them on mobile data when the setting is off', () => {
    expect(make(false, 'cellular').mayDownloadRenditions()).toBe(true);
  });

  /**
   * The reading has not come back yet, or the platform cannot say — as it could not on the phone
   * before this plugin arrived, and as a browser cannot at all. Holding a review session hostage to
   * a value the app was never given is the worse of the two mistakes.
   */
  it('does not treat an unknown connection as metered', () => {
    expect(make(true, 'unknown').mayDownloadRenditions()).toBe(true);
  });

  /** So a screen can say why the photos have stopped arriving, rather than looking broken. */
  it('says when the setting is what is holding downloads back', () => {
    expect(make(true, 'cellular').heldBackByWifiOnly()).toBe(true);
    expect(make(true, 'wifi').heldBackByWifiOnly()).toBe(false);
    expect(make(false, 'cellular').heldBackByWifiOnly()).toBe(false);
  });

  describe('start()', () => {
    /** Lets the awaited platform read settle before the signal is inspected. */
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

    /** Pretends the app went away and came back, which is all `visibilitychange` means here. */
    function appBecomes(state: 'hidden' | 'visible') {
      Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    }

    it('reads the connection once at startup', async () => {
      const service = make(true, 'unknown');

      service.start();
      await settle();

      expect(service.connection()).toBe('wifi');
    });

    it('follows the connection while the app is open', async () => {
      const service = make(true, 'unknown');
      service.start();
      await settle();

      platform.handler?.('cellular');

      expect(service.connection()).toBe('cellular');
    });

    /**
     * The bug this was written for: leaving the house is exactly when the network changes, and the
     * app is in the background when it happens. The event does not survive that, so the app came
     * back believing it was still on Wi-Fi and downloaded over mobile data.
     */
    it('asks again when the app comes back to the foreground', async () => {
      const service = make(true, 'unknown');
      service.start();
      await settle();
      expect(service.connection()).toBe('wifi');

      platform.connection = 'cellular'; // switched while the app was away, no event delivered
      appBecomes('visible');
      await settle();

      expect(service.connection()).toBe('cellular');
    });

    it('does not ask while the app is going away', async () => {
      const service = make(true, 'unknown');
      service.start();
      await settle();
      const atStartup = platform.reads;

      appBecomes('hidden');

      expect(platform.reads).toBe(atStartup);
    });

    /** A browser has no plugin to answer, and nothing metered to protect either. */
    it('holds nothing back where the platform cannot say', async () => {
      const service = make(true, 'unknown');
      platform.connection = 'unknown';

      service.start();
      await settle();

      expect(service.connection()).toBe('unknown');
      expect(service.mayDownloadRenditions()).toBe(true);
    });
  });
});
