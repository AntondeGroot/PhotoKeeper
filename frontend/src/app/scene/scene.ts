import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { PhotoScene } from '../photo';

/** One stylised tree: its triangle points and trunk x, derived once from the row index. */
interface Tree {
  points: string;
  trunkX: number;
}

/** One stylised building: its rect plus the y-positions of its lit windows. */
interface Building {
  x: number;
  top: number;
  w: number;
  h: number;
  far: boolean;
  windowX: number;
  windowW: number;
  windowYs: number[];
}

const TREE_XS = [18, 64, 112, 158, 206, 252];
const BUILDINGS: [number, number, number][] = [
  [10, 210, 42],
  [60, 160, 50],
  [118, 230, 36],
  [162, 140, 56],
  [226, 190, 44],
  [276, 240, 24],
];

/**
 * Renders a {@link PhotoScene} as an SVG "photograph" — a sky wash, a sun, and one of five horizon
 * variants — for mock photos that have no real rendition. A direct port of the prototype's Scene; the
 * forest/city geometry is precomputed here so the template stays declarative.
 */
@Component({
  selector: 'app-scene',
  templateUrl: './scene.html',
  styleUrl: './scene.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SceneComponent {
  @Input({ required: true }) scene!: PhotoScene;

  protected readonly trees: Tree[] = TREE_XS.map((x, i) => ({
    points: `${x},300 ${x + 22},${198 + (i % 3) * 18} ${x + 44},300`,
    trunkX: x + 19,
  }));

  protected readonly buildings: Building[] = BUILDINGS.map(([x, top, w], i) => ({
    x,
    top,
    w,
    h: 400 - top,
    far: i % 2 === 1,
    windowX: x + 6,
    windowW: w - 12,
    windowYs: [0, 1, 2].map((r) => top + 14 + r * 26),
  }));
}
