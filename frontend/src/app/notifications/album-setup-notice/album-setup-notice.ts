import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { LightroomService } from '../../lightroom.service';

/** A Lightroom album Keeper files decisions into. The user must create these themselves (as normal
 *  albums) — the partner API can't create them, and can't write ratings/flags at all, so album
 *  membership is the only durable write-back. See the top-level README ("Lightroom write-back"). */
export interface RequiredAlbum {
  readonly name: string;
  readonly purpose: string;
}

export const REQUIRED_ALBUMS: readonly RequiredAlbum[] = [
  { name: 'KeeperEdit', purpose: 'photos you want to edit' },
  { name: 'KeeperDelete', purpose: 'photos you want to delete' },
  { name: 'KeeperPrint', purpose: 'photos you want to print' },
];

/**
 * Notice shown when the connected Lightroom catalog is missing any of the {@link REQUIRED_ALBUMS}. It
 * fetches the catalog's albums itself, and if any required album is absent it asks the user to create
 * them in Lightroom (Keeper can't — see the interface doc), listing the ones still missing. OK dismisses
 * it for the session; since nothing is persisted, it re-checks and reappears next launch until all three
 * exist. Deliberately OK-only: no deep-link, which is unreliable on mobile. The parent only mounts this
 * once connected (authenticated + onboarded), so the self-fetch always has a valid token.
 */
@Component({
  selector: 'app-album-setup-notice',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './album-setup-notice.html',
  styleUrl: './album-setup-notice.scss',
})
export class AlbumSetupNoticeComponent implements OnInit {
  private readonly svc = inject(LightroomService);

  private readonly albumNames = signal<readonly string[]>([]);
  private readonly checked = signal(false);
  private readonly dismissed = signal(false);

  /** The required albums the catalog is still missing — what the list renders. */
  readonly missing = computed(() => {
    const have = new Set(this.albumNames());
    return REQUIRED_ALBUMS.filter((r) => !have.has(r.name));
  });

  /** Show only after a successful check, while some album is still missing and not yet dismissed. */
  readonly visible = computed(
    () => this.checked() && !this.dismissed() && this.missing().length > 0,
  );

  ngOnInit(): void {
    void this.check();
  }

  private async check(): Promise<void> {
    try {
      const albums = await firstValueFrom(this.svc.getAlbums());
      this.albumNames.set(albums.map((a) => a.name));
      this.checked.set(true);
    } catch {
      // Couldn't verify the catalog — leave the notice hidden this session rather than nag wrongly.
    }
  }

  dismiss(): void {
    this.dismissed.set(true);
  }
}
