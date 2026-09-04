import { FrameSignature } from './detection-types';
import { SIGNATURE_SIZE } from './phash';
import { estimateClockOffset, pairEyes } from './stereo-pairs';

/** A frame at `hh:mm:ss` on one fixed day — the shoots under test never span midnight. */
const at = (id: string, clock: string) => ({ id, taken: `2026-06-14T${clock}Z` });

const NO_SIGNATURES = new Map<string, FrameSignature>();

/**
 * A synthetic signature for shot `shot`, its content shifted `shift` columns to the left.
 *
 * Deterministic noise keyed on the shot, so two different shots correlate no better than chance,
 * while the two eyes of one shot are the *same* picture seen from a step aside — which is a shift,
 * and nothing else. That is exactly the difference the matcher has to see past.
 */
function signatureOf(shot: number, shift = 0): FrameSignature {
  const out = new Uint8Array(SIGNATURE_SIZE * SIGNATURE_SIZE);
  for (let y = 0; y < SIGNATURE_SIZE; y++) {
    for (let x = 0; x < SIGNATURE_SIZE; x++) {
      const scene = x + shift;
      let h =
        (Math.imul(shot, 73856093) ^ Math.imul(scene, 19349663) ^ Math.imul(y, 83492791)) >>> 0;
      h = Math.imul(h ^ (h >>> 13), 2654435761) >>> 0;
      out[y * SIGNATURE_SIZE + x] = (h ^ (h >>> 16)) & 0xff;
    }
  }
  return out;
}

/** Both eyes of shots 1..n: `L<n>` as shot, `R<n>` the same shot from four columns aside. */
function eyeSignatures(...ids: string[]): Map<string, FrameSignature> {
  return new Map(
    ids.map((id) => [id, signatureOf(Number(id.replace(/\D/g, '')), id.startsWith('R') ? 4 : 0)]),
  );
}

describe('pairEyes', () => {
  it('pairs on the pictures when the two clocks agree about nothing at all', () => {
    // The state this has to survive: two bodies nobody synchronised, one of them powered off and
    // back on, so its clock is hours out — and out by a *different* amount per frame, which no
    // single offset can describe. The right album's timestamps say nothing about which frame is which.
    const left = [at('L1', '10:00:00'), at('L2', '10:00:10'), at('L3', '10:00:25')];
    const right = [at('R1', '03:17:41'), at('R2', '22:04:00'), at('R3', '03:18:09')];

    expect(pairEyes(left, right, eyeSignatures('L1', 'L2', 'L3', 'R1', 'R2', 'R3'))).toEqual([
      { leftId: 'L1', rightId: 'R1' },
      { leftId: 'L2', rightId: 'R2' },
      { leftId: 'L3', rightId: 'R3' },
    ]);
  });

  // The whole point of measuring an *aligned* distance. Each right eye here is its shot seen four
  // columns aside — the framing difference two people standing apart produce, and the thing a plain
  // hash mostly measures. Slid back into place, the pairs are exact.
  it('sees past the difference in framing rather than counting it against the pair', () => {
    const left = [at('L1', '10:00:00'), at('L2', '10:00:10')];
    const right = [at('R1', '10:00:00'), at('R2', '10:00:10')];
    const signatures = eyeSignatures('L1', 'L2', 'R1', 'R2');

    // Same scene, no shift at all: whatever the matcher scores a true pair, it must be at least this
    // good — the shift must cost nothing once it is slid out.
    const unshifted = new Map(signatures).set('R1', signatureOf(1));

    expect(pairEyes(left, right, signatures)).toEqual(pairEyes(left, right, unshifted));
  });

  // The bug this replaced a hash pre-filter to fix. Two eyes of one shot can sit far apart on any
  // *hash* — most of that distance is where the photographers stood — so a hash gate threw real
  // pairs out before anything could measure them, and no threshold on it was safe. The coarse first
  // pass is now the same measurement as the careful one, so what it drops, the careful one would
  // have dropped too. Here the two eyes are eight columns apart: beyond the coarse slide of ±2, and
  // well within the fine slide of ±6.
  it('does not let its cheap first pass throw out a pair the careful one would keep', () => {
    const left = [at('L1', '10:00:00')];
    const right = [at('R1', '10:00:00')];
    const signatures = new Map([
      ['L1', signatureOf(1)],
      ['R1', signatureOf(1, 8)],
    ]);

    expect(pairEyes(left, right, signatures)).toEqual([{ leftId: 'L1', rightId: 'R1' }]);
  });

  it('pairs nothing at all without signatures, rather than guessing from the clocks', () => {
    // A tidy five-minute offset — the case the old time-only matcher was built for, and exactly the
    // one that made it dangerous: two frames taken five minutes apart are not a pair because a
    // subtraction came out even. Unscanned frames have no picture, and selection withholds them.
    const left = [at('L1', '10:00:00'), at('L2', '10:00:10'), at('L3', '10:00:25')];
    const right = [at('R1', '10:05:00'), at('R2', '10:05:10'), at('R3', '10:05:25')];

    expect(pairEyes(left, right, NO_SIGNATURES)).toEqual([]);
  });

  it('uses the clocks only to break a tie between two equally alike frames', () => {
    // The right body shot the first scene twice, three seconds apart, so both takes are the same
    // picture and nothing about them can choose. Here — and only here — the clocks get a say: the
    // other pairs establish a five-minute offset, and R1 fits it while R1b sits three seconds off.
    const left = [at('L1', '10:00:00'), at('L2', '10:00:10'), at('L3', '10:00:20')];
    const right = [
      at('R1b', '10:05:03'),
      at('R1', '10:05:00'),
      at('R2', '10:05:10'),
      at('R3', '10:05:20'),
    ];
    const signatures = eyeSignatures('L1', 'L2', 'L3', 'R1', 'R2', 'R3');
    signatures.set('R1b', signatureOf(1, 4)); // a second take of the same scene

    expect(pairEyes(left, right, signatures)).toContainEqual({
      leftId: 'L1',
      rightId: 'R1',
    });
  });
});

describe('estimateClockOffset', () => {
  // Still measured, because it is what the tie-break above compares against — but nothing depends on
  // it any more, and two albums that agree about nothing simply get no tie-break.
  it('votes the offset the true pairs share', () => {
    const left = [at('L1', '10:00:00'), at('L2', '10:00:10'), at('L3', '10:00:25')];
    const right = [at('R1', '10:05:00'), at('R2', '10:05:10'), at('R3', '10:05:25')];

    expect(estimateClockOffset(left, right)).toBe(300_000);
  });
});
