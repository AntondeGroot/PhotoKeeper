// Pure geometry for the detection lab's pano seam overlays: resolves the matched overlap bands between
// two adjacent pano frames and the colours used to draw them. No Angular, no IO — the component calls
// these to render the strips it lays over each thumbnail.

import { PanoOptions, overlapMatch } from '../../detectors/pano';
import { FrameSignature, PanoOrientation } from '../../detectors/detection-types';

/** A matched region as CSS percentages, for overlaying on a lab thumbnail. */
interface StripRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A strip plus the colour of the seam it belongs to (shared with the facing frame's strip). */
export type SeamStrip = StripRect & { color: string };

/** One seam between two adjacent pano frames: the matched overlap regions, colour, and both axis scores. */
export interface PanoSeam {
  color: string;
  hScore: number; // best horizontal slide score (lower = better continuation)
  vScore: number; // best vertical slide score
  overlap: number; // overlap fraction on the chosen axis [0, 1]
  aStrip: StripRect; // matched region on the earlier frame
  bStrip: StripRect; // matched region on the later frame (same overlap → same colour)
}

/** Distinct colours cycled across a pano's seams, so each overlap stands out. */
const SEAM_COLORS = ['#e0a83c', '#4ea0e0', '#7bd86a', '#e06c9c', '#b07be0'];
export const seamColor = (seam: number): string => SEAM_COLORS[seam % SEAM_COLORS.length];

const EMPTY_STRIP: StripRect = { left: 0, top: 0, width: 0, height: 0 };

/** The two matched overlap bands for a seam, ordered [earlier frame, later frame]. */
function seamBands(
  orientation: PanoOrientation,
  forward: boolean,
  overlap: number,
): [StripRect, StripRect] {
  const o = overlap * 100;
  const left: StripRect = { left: 0, top: 0, width: o, height: 100 };
  const right: StripRect = { left: 100 - o, top: 0, width: o, height: 100 };
  const top: StripRect = { left: 0, top: 0, width: 100, height: o };
  const bottom: StripRect = { left: 0, top: 100 - o, width: 100, height: o };
  if (orientation === 'horizontal') return forward ? [right, left] : [left, right];
  return forward ? [bottom, top] : [top, bottom];
}

/** Resolves one seam from two frames' signatures: both axis scores, plus the matched overlap bands. */
export function buildSeam(
  orientation: PanoOrientation,
  sa: FrameSignature | undefined,
  sb: FrameSignature | undefined,
  color: string,
  opts: PanoOptions,
): PanoSeam {
  if (!sa || !sb) {
    return {
      color,
      hScore: NaN,
      vScore: NaN,
      overlap: 0,
      aStrip: EMPTY_STRIP,
      bStrip: EMPTY_STRIP,
    };
  }
  const hm = overlapMatch(sa, sb, 'horizontal', opts);
  const vm = overlapMatch(sa, sb, 'vertical', opts);
  const chosen = orientation === 'horizontal' ? hm : vm;
  const [aStrip, bStrip] = seamBands(orientation, chosen.forward, chosen.overlap);
  return {
    color,
    hScore: Math.round(hm.score),
    vScore: Math.round(vm.score),
    overlap: chosen.overlap,
    aStrip,
    bStrip,
  };
}
