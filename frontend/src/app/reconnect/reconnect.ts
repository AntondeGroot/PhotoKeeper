import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

/**
 * Shown when a Lightroom session the user had is gone and cannot be refreshed back.
 *
 * It takes the whole screen because the alternative was the bug it exists to fix: the session died
 * quietly, the app carried on looking connected, and the only way back in — Connect to Lightroom —
 * was buried in Settings behind a Disconnect button, on a screen the user had no reason to open.
 *
 * Dismissing is offered, not forced. Someone who also reviews photos from this device can carry on
 * with those; the prompt returns next launch, and Settings → Disconnect ends it for good.
 */
@Component({
  selector: 'app-reconnect',
  templateUrl: './reconnect.html',
  styleUrl: './reconnect.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReconnectComponent {
  @Input() loginHref = '';
  /** Whether this device also has photos of its own, which is what dismissing leaves the user with. */
  @Input() hasDeviceSource = false;

  @Output() dismissed = new EventEmitter<void>();
}
