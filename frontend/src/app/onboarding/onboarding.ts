import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { DeviceFolder } from '../photo';
import { DeviceSourceComponent } from '../device-source/device-source';

/**
 * First-run setup. Two independent sources — Adobe Lightroom (OAuth) and this device's local folders —
 * each optional. Continue unlocks once at least one is set up, so a user can run on Lightroom only,
 * device only, or both. The Lightroom connect is a real redirect; on return the host re-shows this
 * screen (still un-onboarded) with `connected` true, so the green check + Continue appear.
 */
@Component({
  selector: 'app-onboarding',
  templateUrl: './onboarding.html',
  styleUrl: './onboarding.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DeviceSourceComponent],
})
export class OnboardingComponent {
  @Input() connected = false;
  /** Verifying the Lightroom token after the redirect — shows the golden spinner instead of Connect. */
  @Input() connecting = false;
  @Input() loginHref = '';
  @Input() error: string | null = null;
  @Input() deviceEnabled = false;
  @Input() deviceFolders: DeviceFolder[] = [];
  /** Whether Continue is allowed yet — at least Lightroom or the device set up. */
  @Input() canContinue = false;

  @Output() deviceToggled = new EventEmitter<boolean>();
  @Output() folderToggled = new EventEmitter<string>();
  @Output() continued = new EventEmitter<void>();
}
