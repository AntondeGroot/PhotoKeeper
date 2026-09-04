import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  computed,
  inject,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { SafeUrl } from '@angular/platform-browser';
import { Stereo, StereoAlbumRef } from '../../photo';
import { lightroomAlbumUrl } from '../../keeper-albums';
import { PreviewCacheService } from '../preview-cache.service';
import { StereoViewerComponent } from '../stereo-viewer/stereo-viewer';

/**
 * What to do about a missing eye — the same advice whichever side went missing, so it is written
 * once here rather than twice in the template.
 */
/** One "go and look in Lightroom" button on an incomplete pair. */
export interface GapAlbumLink {
  /** The album's name, as the button says it. */
  name: string;
  /** Why this album is worth opening — the two buttons are otherwise indistinguishable. */
  role: string;
  url: string;
}

const GAP_HINT =
  'Check the pairing under Albums → Stereo, and that the other eye was imported at all. A frame ' +
  'whose album is still being scanned is never shown here — this one has been looked for.';

@Component({
  selector: 'app-stereo-card',
  templateUrl: './stereo-card.html',
  styleUrl: './stereo-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [StereoViewerComponent],
})
export class StereoCardComponent implements OnChanges {
  private readonly previews = inject(PreviewCacheService);

  @Input() stereo!: Stereo;
  @Output() swiped = new EventEmitter<'kept' | 'rejected' | 'toEdit'>();
  /** Twin-rig only: the user flipped which body is the left eye. Carries the album + new left serial so
   * the host can persist the choice per album. */
  @Output() swapEyes = new EventEmitter<{ albumName: string | null; leftSerial: string }>();
  /** Lightroom catalog id, for the "open the album" links on an incomplete pair. */
  @Input() catalogId: string | null = null;
  /** The user moved past an incomplete pair without judging it — it may yet be shown whole. */
  @Output() skipped = new EventEmitter<void>();
  /**
   * The user settled an incomplete pair as a single photograph: this frame's other eye does not
   * exist, so it is judged on its own rather than waiting for a partner that is never coming.
   */
  @Output() resolved = new EventEmitter<'kept' | 'rejected'>();

  protected readonly gapHint = GAP_HINT;

  verdicts = signal<Record<string, 'keep' | 'edit' | 'reject'>>({});
  twoD = signal(false);
  /** The baseline whose pair is open in the side-by-side viewer, or null when it's closed. */
  viewerBaseline = signal<string | null>(null);
  /** Local left/right flip for immediate feedback; the persisted per-album choice rides swapEyes. */
  private readonly swapped = signal(false);
  /** Which set the state above belongs to, so a new one starts clean — see ngOnChanges. */
  private shownUnitId: string | null = null;

  /** A twin-DSLR set carries two body serials → offer the swap; drone/cha-cha sets don't. */
  get canSwap(): boolean {
    return !!this.stereo.rig;
  }

  /** A summary that reads sensibly for a single pair as well as a multi-baseline (shared-left) set. */
  get meta(): string {
    const s = this.stereo;
    if (s.gap) return 'one eye missing';
    if (s.baselines.length <= 1) return 'stereo pair'; // one L/R pair — nothing "shared" across baselines
    const n = s.left.length;
    return `${n} shared left frame${n === 1 ? '' : 's'} · ${s.baselines.length} baselines`;
  }

  /** The set as shown, with the eyes exchanged when swapped (twin-rig has a single right baseline). */
  get displayStereo(): Stereo {
    const right = this.stereo.baselines[0];
    if (!this.swapped() || !this.stereo.rig || !right) return this.stereo;
    return {
      ...this.stereo,
      left: right.frames,
      baselines: [{ ...right, frames: this.stereo.left }],
      rig: { leftSerial: this.stereo.rig.rightSerial, rightSerial: this.stereo.rig.leftSerial },
    };
  }

  allChosen = computed(() => this.stereo.baselines.every((b) => b.key in this.verdicts()));

  /**
   * What the error card says: which eye is missing, and where it was looked for. Empty for a whole
   * pair, which has nothing to explain.
   */
  get gapMessage(): string {
    const gap = this.stereo.gap;
    if (!gap) return '';
    // Both eyes came out of one album, so which side this frame is was never recorded — the message
    // says what is actually known: nothing else in the album pairs with it.
    // Named albums fall back to the unit's own: a unit queued before gaps carried album ids has no
    // `foundIn`, and a card that says "undefined" is worse than one that says a little less.
    const foundIn = gap.foundIn?.name ?? this.stereo.album;
    if (gap.missing === 'unknown') {
      return `This frame has no other eye — nothing else in “${foundIn}” pairs with it.`;
    }
    const opening = `The ${gap.missing} eye is missing`;
    const searched = gap.expectedIn?.name;
    if (searched) return `${opening} — nothing in “${searched}” matches this frame.`;
    const marked = gap.missing === 'left' ? 'right' : 'left';
    return `${opening} — this album is marked as ${marked} eyes, but no ${gap.missing}-eye album is paired with it.`;
  }

  /**
   * The albums worth opening in Lightroom to settle an incomplete pair: the one the frame is in and,
   * for a split shoot, the one its other eye should have been in.
   *
   * Two buttons rather than a verdict, because this is not a judgement the app can make. Whether the
   * other eye was never imported, went into a third album, or is sitting right there under a name
   * the matcher could not tie to this frame is a question about the library, and the answer is one
   * tap away in Lightroom.
   *
   * Empty when there is nowhere to send anyone: no catalog id yet, or a whole pair with nothing to
   * check.
   */
  get gapAlbums(): GapAlbumLink[] {
    const gap = this.stereo.gap;
    const catalogId = this.catalogId;
    // `foundIn` can be absent on a unit queued before gaps carried album ids. The upgrade drops
    // those (PhotoKeeperDb v24); until it has run, offering no link is the graceful way to fail.
    if (!gap?.foundIn || !catalogId) return [];
    const link = (album: StereoAlbumRef, role: string): GapAlbumLink => ({
      name: album.name,
      role,
      url: lightroomAlbumUrl(catalogId, album.id),
    });
    const searched = gap.expectedIn;
    // A both-eyes album searched itself, and an unpaired one searched nothing: either way there is
    // one album to go and look in, not the same one offered twice.
    if (!searched?.id || searched.id === gap.foundIn.id) return [link(gap.foundIn, 'this album')];
    return [link(gap.foundIn, 'this frame'), link(searched, 'the missing eye')];
  }

  /** How the empty slot is labelled: the eye that should have been there, or '?' when nobody knows. */
  get missingLabel(): string {
    const missing = this.stereo.gap?.missing;
    if (missing === 'left') return 'L';
    if (missing === 'right') return 'R';
    return '?';
  }

  /**
   * Resets what belonged to the set being replaced.
   *
   * The card outlives the unit it shows — the deck advances by handing the same component a new
   * `stereo` — so anything held here is the *previous* photograph's until it is cleared. Baseline
   * keys repeat across sets (`b0`, `b0`, …), so a verdict left behind reappears as a choice already
   * made on a set nobody has looked at yet, with "Done with this set" enabled to match.
   *
   * Keyed on the unit id rather than on the input changing at all, because the same set is re-handed
   * to the card whenever a per-album L/R swap is persisted, and the verdicts given to *that* set are
   * still the user's. The swap flip is dropped either way: the re-hydrated set already carries the
   * corrected L/R, and flipping again would double-swap on top of the album-level change.
   */
  ngOnChanges(): void {
    this.swapped.set(false);
    if (this.stereo.id === this.shownUnitId) return;
    this.shownUnitId = this.stereo.id;
    this.verdicts.set({});
    this.twoD.set(false);
    this.viewerBaseline.set(null);
  }

  /** Flip the left/right eye, and tell the host which serial is now the left one (to persist per album). */
  toggleSwap(): void {
    const rig = this.stereo.rig;
    if (!rig) return;
    const next = !this.swapped();
    this.swapped.set(next);
    this.swapEyes.emit({
      albumName: this.stereo.album,
      leftSerial: next ? rig.rightSerial : rig.leftSerial,
    });
  }

  /** The cached preview for a frame, or null until it's warmed (then the name shows alone). */
  imageUrl(id: string): SafeUrl | null {
    return this.previews.url(id);
  }

  setVerdict(key: string, verdict: 'keep' | 'edit' | 'reject'): void {
    this.verdicts.update((v) => ({ ...v, [key]: verdict }));
  }

  confirm(): void {
    const vals = Object.values(this.verdicts());
    let overall: 'kept' | 'toEdit' | 'rejected';
    if (this.twoD() || vals.includes('edit')) {
      overall = 'toEdit';
    } else if (vals.includes('keep')) {
      overall = 'kept';
    } else {
      overall = 'rejected';
    }
    this.swiped.emit(overall);
  }
}
