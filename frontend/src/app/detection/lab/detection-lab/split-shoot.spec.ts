import { FrameSignature } from '../../detectors/detection-types';
import { SIGNATURE_SIZE } from '../../detectors/phash';
import { buildSplitShootReport } from './split-shoot';

const at = (id: string, clock: string) => ({ id, name: id, taken: `2026-08-01T${clock}Z` });

/** A shot's signature, shifted `shift` columns — the two eyes of one shot differ only by that. */
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

/** The same picture a few levels darker: alike enough to pair, never quite as alike as the original. */
function dimmed(signature: FrameSignature): FrameSignature {
  return signature.map((value) => Math.max(0, value - 6));
}

describe('buildSplitShootReport', () => {
  // The one thing this panel exists to do: tell apart a frame the matcher rejected from one it never
  // saw. Both reach the deck as "missing eye" and they are fixed in opposite ways — the first by the
  // tolerance, the second by the scan — so the report must never render them the same.
  it('separates a frame that was rejected from one that was never scanned', () => {
    const report = buildSplitShootReport({
      left: [at('L_pair', '13:00:00'), at('L_other', '13:01:00'), at('L_unscanned', '13:02:00')],
      right: [at('R_pair', '09:41:07')],
      signatures: new Map([
        ['L_pair', signatureOf(1)],
        ['R_pair', signatureOf(1, 4)], // the same shot, four columns aside
        ['L_other', signatureOf(2)], // a different scene entirely
      ]),
      tolerance: 25,
    });

    const rows = report.rows.map((row) => ({
      outcome: row.outcome,
      left: row.left.id,
      other: row.other?.id ?? null,
      note: row.note,
    }));

    expect(rows).toEqual([
      { outcome: 'paired', left: 'L_pair', other: 'R_pair', note: '' },
      // Rejected, and it names the frame it was rejected against — that is what the panel draws its
      // two thumbnails from, so a distance is never shown without the pictures behind it.
      {
        outcome: 'rejected',
        left: 'L_other',
        other: 'R_pair',
        note: expect.stringContaining('over tolerance') as string,
      },
      {
        outcome: 'notHashed',
        left: 'L_unscanned',
        other: null,
        note: 'not scanned — the matcher never had a picture of this frame',
      },
    ]);
    expect(report.summary).toContain('scanned: left 2/3, right 1/1');
  });

  // The pair is measured at the offset that aligns it, so the framing difference costs it nothing.
  it('scores a true pair far below its nearest wrong answer', () => {
    const report = buildSplitShootReport({
      left: [at('L_pair', '13:00:00'), at('L_other', '13:01:00')],
      right: [at('R_pair', '09:41:07')],
      signatures: new Map([
        ['L_pair', signatureOf(1)],
        ['R_pair', signatureOf(1, 4)],
        ['L_other', signatureOf(2)],
      ]),
      tolerance: 25,
    });

    const paired = report.rows.find((row) => row.outcome === 'paired');
    const rejected = report.rows.find((row) => row.outcome === 'rejected');

    expect(paired?.distance).toBe(0); // slid back into place, an exact match
    expect(rejected?.distance).toBeGreaterThan(25);
  });

  // The report that read as a contradiction: two frames the panel calls alike, and a refusal, with
  // the reason a third frame you could not see. Both eyes here look like shot 1, so the closer of
  // them takes R_pair and the other is left over — and the row has to say so by name.
  it('names the frame that took the candidate, and how well it did', () => {
    const report = buildSplitShootReport({
      left: [at('L_exact', '13:00:00'), at('L_nearly', '13:01:00')],
      right: [at('R_pair', '09:41:07')],
      signatures: new Map([
        ['L_exact', signatureOf(1)],
        ['R_pair', signatureOf(1, 4)],
        ['L_nearly', dimmed(signatureOf(1))], // the same scene, a shade darker — close, but not as close
      ]),
      tolerance: 25,
    });

    const loser = report.rows.find((row) => row.left.id === 'L_nearly');

    expect(loser?.outcome).toBe('rejected');
    expect(loser?.claimedBy?.frame.id).toBe('L_exact');
    expect(loser?.claimedBy?.distance).toBe(0);
    // Spelled out in the report's own words: the *right* frame went elsewhere. The short form read
    // as though this left frame had been matched with another left frame.
    expect(loser?.note).toContain('the right frame went to L_exact instead');
  });
});
