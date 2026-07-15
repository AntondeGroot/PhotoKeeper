// Throwaway (lightroom-write-back): lab buttons that run the backend write-spikes against the real
// Lightroom catalog. "Set ★5 + pick" / "Set reject" set per-asset review metadata (the culling payoff:
// keep/reject→flag, ★5→rating) and dump the asset's payload before/after so we can see which field
// Lightroom stores each under — this is the confirming spike for (B) in the write-back plan. The album
// buttons are the earlier surface probe: "Album write-spike" adds an asset to a user-made "KeeperTest"
// album; "Create album via API" reports the subtype that stuck (album creation is blocked — dead end).
// All report the raw Lightroom error on failure. Delete once the real verdict→metadata flow is built.

import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { LightroomService } from '../../../lightroom.service';

@Component({
  selector: 'app-album-spike',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="spike">
      <header class="spike__head">
        <span class="spike__badge">DEV</span>
        <h3 class="spike__title">Lightroom write-back validation</h3>
      </header>
      <p class="spike__note">
        Throwaway probes proving what Adobe's partner API can and can't write, run against the real
        catalog. Targets the first analysed frame — analyse an album first.
      </p>

      <div class="spike__group spike__group--fail">
        <span class="spike__label">Per-asset rating / flag — expected to fail</span>
        <div class="spike__row">
          <button (click)="review(5, 'pick')" [disabled]="busy()">Set ★5 + pick</button>
          <button (click)="review(0, 'reject')" [disabled]="busy()">Set reject</button>
        </div>
        <p class="spike__hint">
          No write endpoint exists — these return a “duplicate asset” 403, proving ratings and flags
          can't be pushed back into Lightroom.
        </p>
      </div>

      <div class="spike__group spike__group--ok">
        <span class="spike__label">Album membership — works</span>
        <div class="spike__row">
          <button (click)="run()" [disabled]="busy()">Add to “KeeperTest” album</button>
          <button (click)="create()" [disabled]="busy()">Create album via API</button>
        </div>
        <p class="spike__hint">
          Adding a photo to an existing user album succeeds; creating an album via the API is
          blocked.
        </p>
      </div>

      @if (result(); as r) {
        <pre class="spike__out">{{ r }}</pre>
      }
    </section>
  `,
  styles: `
    .spike {
      margin: 16px 0 4px;
      padding: 14px 16px;
      border: 1px dashed var(--c-line, #2a2724);
      border-radius: 10px;
      background: color-mix(in srgb, var(--c-panel, #1b1917) 55%, transparent);
    }
    .spike__head {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .spike__badge {
      font:
        600 10px/1 ui-monospace,
        monospace;
      letter-spacing: 0.08em;
      padding: 3px 6px;
      border-radius: 4px;
      background: var(--c-amber, #d9a441);
      color: #131110;
    }
    .spike__title {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
      color: var(--c-text, #e8e2d8);
    }
    .spike__note {
      margin: 6px 0 12px;
      font-size: 12px;
      line-height: 1.5;
      color: var(--c-dim, #9a938a);
    }
    .spike__group {
      margin: 10px 0;
      padding: 10px 12px;
      border-radius: 8px;
      border-left: 3px solid var(--c-line, #2a2724);
      background: color-mix(in srgb, var(--c-panel, #1b1917) 70%, transparent);
    }
    .spike__group--fail {
      border-left-color: #e06c6c;
    }
    .spike__group--ok {
      border-left-color: var(--c-amber, #d9a441);
    }
    .spike__label {
      display: block;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--c-dim, #9a938a);
    }
    .spike__row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 8px 0;
    }
    .spike__row button {
      padding: 6px 12px;
      border-radius: 8px;
      border: 1px solid var(--c-line, #2a2724);
      background: var(--c-panel, #1b1917);
      color: var(--c-text, #e8e2d8);
      font-size: 13px;
      cursor: pointer;
    }
    .spike__row button:hover:not(:disabled) {
      border-color: var(--c-amber, #d9a441);
    }
    .spike__row button:disabled {
      opacity: 0.5;
      cursor: default;
    }
    .spike__hint {
      margin: 4px 0 0;
      font-size: 11px;
      line-height: 1.5;
      color: var(--c-faint, #6f6a62);
    }
    .spike__out {
      margin: 12px 0 0;
      padding: 12px;
      background: #131110;
      border: 1px solid var(--c-line, #2a2724);
      border-radius: 8px;
      font:
        12px/1.5 ui-monospace,
        monospace;
      color: #d8d2c8;
      white-space: pre-wrap;
      max-height: 320px;
      overflow: auto;
    }
  `,
})
export class AlbumSpikeComponent {
  private readonly svc = inject(LightroomService);
  /** An asset to also add to the album (e.g. the lab's first analysed frame), to test add-asset too. */
  readonly assetId = input('');
  readonly busy = signal(false);
  readonly result = signal('');

  async run(): Promise<void> {
    this.busy.set(true);
    this.result.set('Running…');
    try {
      const report = await firstValueFrom(this.svc.runAlbumSpike('KeeperTest', this.assetId()));
      this.result.set(JSON.stringify(report, null, 2));
    } catch {
      this.result.set('Spike request failed — check auth / network / backend log.');
    } finally {
      this.busy.set(false);
    }
  }

  /** Set a star rating + pick/reject flag on the target asset and dump its payload before/after. */
  async review(rating: number, flag: string): Promise<void> {
    this.busy.set(true);
    this.result.set('Writing review metadata…');
    try {
      const report = await firstValueFrom(this.svc.runReviewSpike(rating, flag, this.assetId()));
      this.result.set(JSON.stringify(report, null, 2));
    } catch {
      this.result.set('Review spike request failed — check auth / network / backend log.');
    } finally {
      this.busy.set(false);
    }
  }

  /** Create a fresh album via the API; unique name per click so repeated tries don't collide. */
  async create(): Promise<void> {
    this.busy.set(true);
    this.result.set('Creating…');
    const name = `KeeperAuto-${Date.now().toString(36).slice(-4)}`;
    try {
      const report = await firstValueFrom(this.svc.runCreateAlbumSpike(name));
      this.result.set(JSON.stringify(report, null, 2));
    } catch {
      this.result.set('Create request failed — check auth / network / backend log.');
    } finally {
      this.busy.set(false);
    }
  }
}
