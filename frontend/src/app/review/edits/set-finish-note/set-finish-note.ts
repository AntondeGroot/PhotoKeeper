import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { FrameSetKind, mergedName } from '../frame-sets';
import { SetFinishService } from '../set-finish.service';

/** What became of looking for a set's merged file, and what can be done next. */
@Component({
  selector: 'app-set-finish-note',
  templateUrl: './set-finish-note.html',
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './set-finish-note.scss',
})
export class SetFinishNoteComponent {
  private readonly finish = inject(SetFinishService);

  readonly rowId = input.required<string>();
  readonly frameIds = input.required<readonly string[]>();
  readonly kind = input.required<FrameSetKind>();

  protected readonly state = computed(() => this.finish.state().get(this.rowId()));
  protected readonly merged = computed(() => mergedName(this.kind()));

  protected lookAgain(): void {
    void this.finish.finish(this.rowId(), this.frameIds());
  }

  protected stopTrying(): void {
    this.finish.stopTrying(this.rowId());
  }

  protected sendToPrint(): void {
    void this.finish.sendFramesToPrint(this.rowId(), this.frameIds());
  }

  protected finishWithoutMerge(): void {
    void this.finish.finishWithoutMerge(this.rowId(), this.frameIds());
  }
}
