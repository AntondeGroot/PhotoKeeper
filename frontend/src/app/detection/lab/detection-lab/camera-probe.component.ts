// Throwaway (stereo-pairing): a self-contained lab control that reports the camera identity Lightroom
// returns for an album's frames, to settle whether a twin-DSLR rig's two bodies are separable by EXIF
// (the precondition for a per-album left/right default). Delete this file + its sibling once decided.

import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { LightroomService } from '../../../lightroom.service';
import { buildCameraProbeReport } from './camera-probe';

@Component({
  selector: 'app-camera-probe',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button (click)="probe()" [disabled]="!albumId()">Probe camera EXIF</button>
    @if (report(); as r) {
      <pre class="probe">{{ r }}</pre>
    }
  `,
  styles: `
    .probe {
      margin: 8px 0;
      padding: 12px;
      background: #131110;
      border: 1px solid #2a2724;
      border-radius: 8px;
      font:
        12px/1.5 ui-monospace,
        monospace;
      color: #d8d2c8;
      white-space: pre-wrap;
    }
  `,
})
export class CameraProbeComponent {
  private readonly svc = inject(LightroomService);
  readonly albumId = input('');
  readonly report = signal('');

  async probe(): Promise<void> {
    const id = this.albumId();
    if (!id) return;
    this.report.set('Probing…');
    try {
      const assets = await firstValueFrom(this.svc.getAllAlbumAssets(id));
      this.report.set(buildCameraProbeReport(assets.filter((a) => a.subtype === 'image')));
    } catch {
      this.report.set('Camera probe failed — check auth / network.');
    }
  }
}
