import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { KeeperAlbumsService } from '../../keeper-albums.service';

/**
 * Notice shown when the connected Lightroom catalog is missing any of the required Keeper albums. It
 * asks {@link KeeperAlbumsService} — the one place that knows — and if any are absent it asks the user
 * to create them in Lightroom (Keeper can't: the partner API cannot create albums, and album membership
 * is the only durable write-back there is; see the README). OK dismisses it for the session; since
 * nothing is persisted, it re-checks and reappears next launch until all three exist. Deliberately
 * OK-only: no deep-link, which is unreliable on mobile. The parent only mounts this once connected
 * (authenticated + onboarded), so the check always has a valid token.
 */
@Component({
  selector: 'app-album-setup-notice',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './album-setup-notice.html',
  styleUrl: './album-setup-notice.scss',
})
export class AlbumSetupNoticeComponent implements OnInit {
  private readonly albums = inject(KeeperAlbumsService);

  private readonly dismissed = signal(false);

  /** The required albums the catalog is still missing — what the list renders. */
  readonly missing = this.albums.missing;

  /** Show only after a successful check, while some album is still missing and not yet dismissed. */
  readonly visible = computed(
    () => this.albums.checked() && !this.dismissed() && this.missing().length > 0,
  );

  ngOnInit(): void {
    void this.albums.ensure();
  }

  dismiss(): void {
    this.dismissed.set(true);
  }
}
