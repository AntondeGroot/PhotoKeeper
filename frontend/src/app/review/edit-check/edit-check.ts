import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { EditDetectionService, EditFinding } from '../edit-detection.service';

/**
 * What the check found, and what to do about it.
 *
 * <p>A panel rather than a lane on the Edit tab: it is the answer to a question that was asked, not
 * a standing view, and it is dismissed once acted on. Everything it lists is a photo whose picture
 * has genuinely changed since it was sent to edit — the ones whose revision moved without the
 * photograph changing are counted, but not offered, because sending one to print would print the
 * version that was already there.
 */
@Component({
  selector: 'app-edit-check',
  templateUrl: './edit-check.html',
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './edit-check.scss',
})
export class EditCheckComponent {
  private readonly detection = inject(EditDetectionService);

  readonly findings = this.detection.editedFindings;
  readonly checking = this.detection.checking;
  readonly failed = this.detection.failed;

  /** Everything checked, for the line that says what was looked at and what was left alone. */
  readonly examined = computed(() => this.detection.findings() ?? []);
  readonly untouched = computed(
    () => this.examined().filter((f) => f.state === 'untouched').length,
  );
  readonly metadataOnly = computed(
    () => this.examined().filter((f) => f.state === 'touched').length,
  );
  readonly unknown = computed(() => this.examined().filter((f) => f.state === 'unknown').length);

  /** Which rows are ticked. Everything the check offers starts ticked — that is the common answer. */
  private readonly cleared = signal<ReadonlySet<string>>(new Set());
  readonly selected = computed(
    () =>
      new Set(
        this.findings()
          .map((f) => f.assetId)
          .filter((id) => !this.cleared().has(id)),
      ),
  );

  isSelected(id: string): boolean {
    return this.selected().has(id);
  }

  toggle(id: string): void {
    this.cleared.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  close(): void {
    this.detection.closePanel();
  }

  /** "These are done" — the ticked photos become printable. */
  sendSelected(): void {
    void this.detection.sendToPrint([...this.selected()]);
  }

  /** "Not happy with that one" — it stays in the queue, measured from how it looks now. */
  keepEditing(finding: EditFinding): void {
    void this.detection.keepEditing(finding);
  }
}
