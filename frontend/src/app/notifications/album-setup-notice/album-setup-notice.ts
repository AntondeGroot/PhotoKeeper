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
  template: `
    @if (visible()) {
      <div class="asn" role="dialog" aria-modal="true" aria-labelledby="asn-title">
        <div class="asn__card">
          <h2 id="asn-title" class="asn__title">Set up your Lightroom albums</h2>
          <p class="asn__body">
            Keeper can't change ratings or flags in Lightroom — but it <em>can</em> file your photos
            into albums you've made. Create these albums in Lightroom (as normal albums) and Keeper
            will sort your decisions into them:
          </p>

          <ul class="asn__list">
            @for (album of missing(); track album.name) {
              <li class="asn__item">
                <code class="asn__name">{{ album.name }}</code>
                <span class="asn__purpose">{{ album.purpose }}</span>
              </li>
            }
          </ul>

          <p class="asn__hint">
            Once they exist, every edit, print, and delete decision you make syncs into the matching
            album automatically. This reminder disappears when all three albums are present.
          </p>

          <button type="button" class="asn__ok" (click)="dismiss()">OK</button>
        </div>
      </div>
    }
  `,
  styles: `
    .asn {
      position: fixed;
      inset: 0;
      z-index: 90;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background: rgba(0, 0, 0, 0.62);
      backdrop-filter: blur(3px);
    }
    .asn__card {
      width: 100%;
      max-width: 360px;
      padding: 22px 22px 18px;
      border: 1px solid rgba(229, 160, 69, 0.28);
      border-radius: 18px;
      background: var(--c-panel2, #221e1a);
      box-shadow: 0 20px 44px -14px rgba(0, 0, 0, 0.7);
    }
    .asn__title {
      margin: 0 0 10px;
      font-family: var(--font-head, Georgia, serif);
      font-style: italic;
      font-size: 22px;
      font-weight: 600;
      color: var(--c-amber, #e5a045);
    }
    .asn__body {
      margin: 0 0 14px;
      font-size: 14px;
      line-height: 1.5;
      color: var(--c-text, #ede6dc);
    }
    .asn__body em {
      font-style: italic;
      color: var(--c-amber, #e5a045);
    }
    .asn__list {
      margin: 0 0 12px;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .asn__item {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 8px 12px;
      border-radius: 10px;
      border-left: 3px solid var(--c-amber, #e5a045);
      background: color-mix(in srgb, var(--c-amber, #e5a045) 10%, transparent);
    }
    .asn__name {
      font:
        13px/1.4 ui-monospace,
        monospace;
      color: var(--c-text, #ede6dc);
    }
    .asn__purpose {
      font-size: 12px;
      color: var(--c-dim, #9a9087);
    }
    .asn__hint {
      margin: 0 0 16px;
      font-size: 12px;
      line-height: 1.5;
      color: var(--c-faint, #6e665e);
    }
    .asn__ok {
      display: block;
      width: 100%;
      padding: 11px;
      border: none;
      border-radius: 12px;
      background: var(--c-amber, #e5a045);
      color: #131110;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
    }
  `,
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
