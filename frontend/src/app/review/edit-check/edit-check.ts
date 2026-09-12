import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { SafeUrl } from '@angular/platform-browser';
import { EditDetectionService, EditFinding } from '../edit-detection.service';
import { MergedPhoto } from '../merged-photo';

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

  readonly checking = this.detection.checking;
  readonly failed = this.detection.failed;
  /** Whether the user asked for the list rather than for the check — see {@link rows}. */
  readonly picking = this.detection.picking;

  /** What the panel lists — the service decides, since it also fetches the pictures for them. */
  readonly rows = this.detection.shownFindings;

  /** Everything checked, for the line that says what was looked at and what was left alone. */
  readonly examined = computed(() => this.detection.findings() ?? []);
  readonly untouched = computed(
    () => this.examined().filter((f) => f.state === 'untouched').length,
  );
  readonly metadataOnly = computed(
    () => this.examined().filter((f) => f.state === 'touched').length,
  );
  readonly unknown = computed(() => this.examined().filter((f) => f.state === 'unknown').length);

  /** Which rows are ticked. */
  readonly selected = signal<ReadonlySet<string>>(new Set());

  constructor() {
    // Each new list opens on the answer that is usually right. What the check *found* is a list of
    // edits to send on, so it starts ticked; a list the user asked to pick from starts empty, since
    // picking is the whole reason they asked.
    effect(() => {
      const rows = this.rows();
      const picking = this.picking();
      untracked(() =>
        this.selected.set(picking ? new Set() : new Set(rows.map((row) => row.assetId))),
      );
    });
  }

  /**
   * Frames that have become one photograph since they were sent off — a panorama, an HDR, or both.
   *
   * Listed above the findings rather than among them: a finding asks "is this one done?", while this
   * says that several photographs have become one — a different question, and one press of it
   * settles the whole set.
   */
  readonly merges = this.detection.merges;

  /** "Yes, that is it" — the merge becomes the photograph and its frames stand down. */
  settleMerge(merge: MergedPhoto): void {
    void this.detection.settleMerge(merge);
  }

  /** The photo for a row, once its preview has arrived. */
  thumbnail(assetId: string): SafeUrl | undefined {
    return this.detection.thumbnails().get(assetId);
  }

  isSelected(id: string): boolean {
    return this.selected().has(id);
  }

  toggle(id: string): void {
    this.selected.update((set) => {
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
