import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { KeeperAlbumsService } from '../../keeper-albums.service';
import { KeeperFilingService } from '../keeper-filing.service';
import { albumSearchLinks, isPrintBin } from '../../keeper-albums';

/** One album's worth of tidying: which album, how many photos, and the links to reach them. */
export interface TidyRow {
  album: string;
  count: number;
  links: string[];
}

/** Which albums a placement cares about — the whole point being to show it where it is relevant. */
export type TidyScope = 'edit' | 'print';

/**
 * "These photos are in an album they no longer belong in — here is a link to exactly them."
 *
 * <p>The residue of a one-way API: Lightroom lets the app put a photo into an album and never take
 * it out, so an album accumulates everything ever sent there, including everything since undone.
 * The app cannot tidy that up, but it knows precisely what needs tidying, and a search link can put
 * the user in front of those photos and nothing else.
 *
 * <p>One component rather than a copy per screen, because it is offered in three places — the Edit
 * tab, the Prints tab and Settings — and a notice that said something different in each would be
 * worse than one that appeared only once.
 */
@Component({
  selector: 'app-tidy-up',
  templateUrl: './tidy-up.html',
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './tidy-up.scss',
})
export class TidyUpComponent {
  private readonly albums = inject(KeeperAlbumsService);
  private readonly filing = inject(KeeperFilingService);

  /** The catalogue the links point into; nothing is offered without it. */
  readonly catalogId = input<string | null>(null);
  /** Which albums to report on — the print bins, or the edit album. */
  readonly scope = input<TidyScope>('edit');

  private readonly rows = signal<TidyRow[]>([]);
  readonly tidyRows = computed(() => this.rows());
  readonly total = computed(() => this.rows().reduce((sum, row) => sum + row.count, 0));

  constructor() {
    // Once, when this appears. The tabs that host it are rendered behind an @if, so Angular builds
    // and destroys it as they open and close — which makes construction exactly the moment to look,
    // and means the walk over every filing record never happens behind a screen nobody is on.
    effect(() => void this.refresh());
  }

  /** Recomputes what needs tidying. Also callable by a host that has changed something itself. */
  async refresh(): Promise<void> {
    const catalogId = this.catalogId();
    if (!catalogId) return;
    await this.albums.ensure();
    const stale = await this.filing.staleFilings();
    this.rows.set(
      [...stale]
        .filter(([album]) => (this.scope() === 'print') === isPrintBin(album))
        .map(([album, names]) => ({
          album,
          count: names.length,
          links: this.linksFor(catalogId, album, names),
        }))
        .filter((row) => row.links.length > 0),
    );
  }

  /** No links when the album is not in the catalogue: a door that opens on nothing is worse. */
  private linksFor(catalogId: string, album: string, names: string[]): string[] {
    const albumId = this.albums.idFor(album);
    return albumId ? albumSearchLinks(catalogId, albumId, names) : [];
  }
}
