import { StereoPairingInput, pairStereoAlbums } from './stereo-pairing';
import { FrameSignature } from '../../detection/detectors/detection-types';
import { SIGNATURE_SIZE } from '../../detection/detectors/phash';
import { AlbumUnits, selectUnits } from './unit-selection';
import { PhotoAsset } from '../../lightroom-types';
import { Stereo } from '../../photo';

const LEFT_ID = 'al-left';
const RIGHT_ID = 'al-right';
const BOTH_ID = 'al-both';

/** A frame in an album, taken at `hh:mm:ss` on one fixed day. */
function asset(id: string, clock: string): PhotoAsset {
  return {
    id,
    subtype: 'image',
    payload: { captureDate: `2026-06-14T${clock}Z`, importSource: { fileName: `${id}.CR2` } },
  };
}

/**
 * A synthetic signature for shot `shot`, its content shifted `shift` columns to the left.
 *
 * Deterministic noise keyed on the shot, so two different shots correlate no better than chance,
 * while the two eyes of one shot are the same picture seen from a step aside — a shift, and nothing
 * else. Signatures rather than hashes because the signature is what decides a pair; the hash is only
 * a cheap pre-filter, and an absent one lets a candidate through.
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

/**
 * Runs the pairing with both albums scanned to the end — the state a gap may be reported from. A
 * test about an unfinished scan says so by overriding `fullyScanned`.
 */
function pair(
  input: Omit<StereoPairingInput, 'signatures' | 'groupedIds' | 'fullyScanned'> &
    Partial<StereoPairingInput>,
) {
  return pairStereoAlbums({
    signatures: new Map(),
    groupedIds: new Set(),
    fullyScanned: new Set([LEFT_ID, RIGHT_ID, BOTH_ID]),
    ...input,
  });
}

describe('pairStereoAlbums, through selection', () => {
  it('turns two linked albums into stereo units and takes the right album off the deck', () => {
    const leftAssets = [asset('L1', '10:00:00'), asset('L2', '10:00:20')];
    // The right body's clock runs two seconds behind — the pairing is by measured offset, not by
    // frames sharing a timestamp.
    const rightAssets = [asset('R1', '09:59:58'), asset('R2', '10:00:18')];

    const split = pair({
      roles: { Left: 'left', Right: 'right' },
      partners: { Left: 'Right' },
      albumIdByName: new Map([
        ['Left', LEFT_ID],
        ['Right', RIGHT_ID],
      ]),
      assetsByAlbum: new Map([
        [LEFT_ID, leftAssets],
        [RIGHT_ID, rightAssets],
      ]),
      signatures: eyeSignatures('L1', 'L2', 'R1', 'R2'),
    });

    const albums: AlbumUnits[] = [
      {
        albumId: LEFT_ID,
        albumName: 'Left',
        isVacation: false,
        assets: [...leftAssets, ...(split.extraAssets.get(LEFT_ID) ?? [])],
        groups: split.groups.get(LEFT_ID) ?? [],
        stereoLeftEyeIds: split.leftEyeIds,
      },
      { albumId: RIGHT_ID, albumName: 'Right', isVacation: false, assets: rightAssets, groups: [] },
    ].filter((album) => !split.hiddenAlbumIds.has(album.albumId));

    const units = selectUnits(albums, 10, () => 0.5);

    // Both shots come back whole: two stereo units, no singles. A left frame arriving on its own
    // would be the bug this exists to prevent — the eye judged alone, and the pair never shown.
    expect(units.map((unit) => unit.kind)).toEqual(['stereo', 'stereo']);
    const eyes = (units as Stereo[]).map((unit) => [
      unit.left.map((frame) => frame.id),
      unit.baselines.flatMap((baseline) => baseline.frames.map((frame) => frame.id)),
    ]);
    expect(eyes).toEqual(
      expect.arrayContaining([
        [['L1'], ['R1']],
        [['L2'], ['R2']],
      ]),
    );
  });

  it('offers a left frame whose partner is not there as an incomplete pair, not as a photo', () => {
    const leftAssets = [asset('L1', '10:00:00'), asset('L2', '10:00:20'), asset('L3', '10:00:40')];
    // The right album has only been read as far as the second shot — the state of every backfill,
    // since the two albums are scanned a prefix at a time and rarely reach the same depth at once.
    const rightAssets = [asset('R1', '09:59:58'), asset('R2', '10:00:18')];

    const split = pair({
      roles: { Left: 'left', Right: 'right' },
      partners: { Left: 'Right' },
      albumIdByName: new Map([
        ['Left', LEFT_ID],
        ['Right', RIGHT_ID],
      ]),
      assetsByAlbum: new Map([
        [LEFT_ID, leftAssets],
        [RIGHT_ID, rightAssets],
      ]),
      signatures: eyeSignatures('L1', 'L2', 'L3', 'R1', 'R2'),
    });

    expect(split.gaps.get('L3')).toEqual({
      missing: 'right',
      foundIn: { name: 'Left', id: LEFT_ID },
      expectedIn: { name: 'Right', id: RIGHT_ID },
    });

    const units = selectUnits(
      [
        {
          albumId: LEFT_ID,
          albumName: 'Left',
          isVacation: false,
          assets: [...leftAssets, ...(split.extraAssets.get(LEFT_ID) ?? [])],
          groups: split.groups.get(LEFT_ID) ?? [],
          stereoLeftEyeIds: split.leftEyeIds,
          stereoGaps: split.gaps,
        },
      ],
      10,
      () => 0.5,
    );

    // Three stereo units, never a photo: the two whole pairs, and L3 as a pair with its right eye
    // named as missing. Offered as a photograph it would invite a verdict, which would keep it out
    // of every later selection — and the shot could then never be shown whole.
    expect(units.map((unit) => unit.kind)).toEqual(['stereo', 'stereo', 'stereo']);
    const incomplete = (units as Stereo[]).find((unit) => unit.gap);
    expect(incomplete?.left.map((frame) => frame.id)).toEqual(['L3']);
    expect(incomplete?.baselines[0].frames).toEqual([]);
  });

  it('brings an unpaired right-eye frame back through the left album, missing its left eye', () => {
    const leftAssets = [asset('L1', '10:00:00'), asset('L2', '10:00:20'), asset('L3', '10:00:40')];
    // The right body fired a fourth time; the left one did not. The right album is off the deck
    // wholesale, so if that frame is not carried over by the left album it is seen by nobody.
    const rightAssets = [
      asset('R1', '09:59:58'),
      asset('R2', '10:00:18'),
      asset('R3', '10:00:38'),
      asset('R4', '10:02:00'),
    ];

    const split = pair({
      roles: { Left: 'left', Right: 'right' },
      partners: { Left: 'Right' },
      albumIdByName: new Map([
        ['Left', LEFT_ID],
        ['Right', RIGHT_ID],
      ]),
      assetsByAlbum: new Map([
        [LEFT_ID, leftAssets],
        [RIGHT_ID, rightAssets],
      ]),
      signatures: eyeSignatures('L1', 'L2', 'L3', 'R1', 'R2', 'R3', 'R4'),
    });

    // Found in the right album, looked for in the left: the card offers both to open, and the one
    // the frame is actually in is the right album — not the left one the unit is filed under.
    expect(split.gaps.get('R4')).toEqual({
      missing: 'left',
      foundIn: { name: 'Right', id: RIGHT_ID },
      expectedIn: { name: 'Left', id: LEFT_ID },
    });
    expect(split.extraAssets.get(LEFT_ID)?.map((a) => a.id)).toContain('R4');

    const units = selectUnits(
      [
        {
          albumId: LEFT_ID,
          albumName: 'Left',
          isVacation: false,
          assets: [...leftAssets, ...(split.extraAssets.get(LEFT_ID) ?? [])],
          groups: split.groups.get(LEFT_ID) ?? [],
          stereoLeftEyeIds: split.leftEyeIds,
          stereoGaps: split.gaps,
        },
      ],
      10,
      () => 0.5,
    );

    // R4 arrives as a pair with the *left* side empty — the eye that is there sits on the right.
    const incomplete = (units as Stereo[]).find((unit) => unit.gap);
    expect(incomplete?.left).toEqual([]);
    expect(incomplete?.baselines[0].frames.map((frame) => frame.id)).toEqual(['R4']);
  });

  it('marks every frame of a left album that was never paired with a right one', () => {
    const leftAssets = [asset('L1', '10:00:00'), asset('L2', '10:00:20')];

    const split = pair({
      roles: { Left: 'left' },
      partners: {},
      albumIdByName: new Map([['Left', LEFT_ID]]),
      assetsByAlbum: new Map([[LEFT_ID, leftAssets]]),
    });

    // No album to have looked in, so nothing is named — the card says the pairing was never set up.
    const gap = { missing: 'right', foundIn: { name: 'Left', id: LEFT_ID }, expectedIn: null };
    expect([...split.gaps]).toEqual([
      ['L1', gap],
      ['L2', gap],
    ]);

    const units = selectUnits(
      [
        {
          albumId: LEFT_ID,
          albumName: 'Left',
          isVacation: false,
          assets: leftAssets,
          groups: [],
          stereoGaps: split.gaps,
        },
      ],
      10,
      () => 0.5,
    );

    // The album is marked as holding left eyes, so it holds no photographs — only halves.
    expect(units.map((unit) => unit.kind)).toEqual(['stereo', 'stereo']);
  });

  it('marks every frame of a right album that no left album has claimed', () => {
    const rightAssets = [asset('R1', '10:00:00')];

    const split = pair({
      // A left album exists but points somewhere else, so this one is still nobody's other half.
      roles: { Left: 'left', Right: 'right', Other: 'right' },
      partners: { Left: 'Other' },
      albumIdByName: new Map([['Right', RIGHT_ID]]),
      assetsByAlbum: new Map([[RIGHT_ID, rightAssets]]),
    });

    expect(split.gaps.get('R1')).toEqual({
      missing: 'left',
      foundIn: { name: 'Right', id: RIGHT_ID },
      expectedIn: null,
    });
    // Unclaimed, so it is never hidden either: hiding it would take the frames off the deck without
    // anything anywhere offering them, which is how a half disappears silently.
    expect([...split.hiddenAlbumIds]).toEqual([]);
  });

  it('withholds an unpaired left frame while the right album is still being scanned', () => {
    const leftAssets = [asset('L1', '10:00:00'), asset('L2', '10:00:20'), asset('L3', '10:00:40')];
    const rightAssets = [asset('R1', '09:59:58'), asset('R2', '10:00:18'), asset('R3', '10:00:38')];

    const split = pair({
      roles: { Left: 'left', Right: 'right' },
      partners: { Left: 'Right' },
      albumIdByName: new Map([
        ['Left', LEFT_ID],
        ['Right', RIGHT_ID],
      ]),
      assetsByAlbum: new Map([
        [LEFT_ID, [...leftAssets, asset('L4', '10:01:00')]],
        [RIGHT_ID, rightAssets],
      ]),
      signatures: eyeSignatures('L1', 'L2', 'L3', 'L4', 'R1', 'R2', 'R3'),
      // The right album's cursor has not reached L4's shot yet — the ordinary state of a backfill,
      // since the two albums are read a prefix at a time.
      fullyScanned: new Set([LEFT_ID]),
    });

    // L4 is held back, not reported: an unfinished scan is not evidence that the other eye is gone,
    // and a card claiming one would be wrong through most of every backfill.
    expect([...split.withheldIds]).toEqual(['L4']);
    expect([...split.gaps]).toEqual([]);
  });
});
