"""Slice the surviving sheets into individual tiles for review.

Tiers A and C are free-floating characters on a flat ground, so their background
is keyed to alpha (flood-filled from the crop border, which leaves cream areas
*inside* the character - muzzle, eye patches - opaque). Tier B tiles are framed
painterly cards and stay opaque.

`x2` carries a baked-in caption under each tile; the caption band is split off
into its own image so the art can ship clean while the text stays readable
during review.
"""
import json
import os
import time

import numpy as np
from PIL import Image

import segment

OUT = os.path.dirname(os.path.abspath(__file__))
CROPS = f"{OUT}/crops"
THUMBS = f"{CROPS}/thumbs"

# The grid view shows every surviving tile at once - several hundred full-res
# PNGs is tens of MB and the review server serves them one at a time, so the
# grid gets a downscaled copy and only focus/lightbox load the real crop.
THUMB_PX = 320

# sheet -> (tier, note)
#
# Every unique sheet, not just the triage survivors: the review now starts from
# the full set and culls in rounds. `achievements3` and `celebrations6` are
# md5-identical to `achievements2` / `celebrations5` and are the only omissions.
SHEETS = {
    # Style A - flat cartoon, cream ground
    "mascot":         ("A", "hero mascot"),
    "achievements1":  ("A", "photography poses"),
    "achievements4":  ("A", "achievement poses"),
    "achievements5":  ("A", "achievement poses"),
    "celebrations5":  ("A", "achievement poses"),
    "celebrations7":  ("A", "achievement poses"),
    "celebrations8":  ("A", "achievement poses (cleanest of 5 twins)"),
    "celebrations3":  ("A", "holidays + national days"),
    "reactions1":     ("A", "reactions"),
    "reactions2":     ("A", "reactions"),
    # Style C - sepia storybook
    "x3":             ("C", "occasions incl. birthday + graduation"),
    "celebrations2":  ("C", "seasonal + holidays"),
    # Style B - painterly vintage, framed cards
    "x2":             ("B", "backlog narrative, captioned"),
    "x":              ("B", "backlog / archive"),
    "celebrations9":  ("B", "backlog narrative"),
    "celebrations":   ("B", "holidays + national days"),
    "celebrations4":  ("B", "holidays + national days"),
    "achievements2":  ("B", "achievements, labels baked in"),
    "scenes1":        ("B", "hobby vignettes"),
}

ALPHA_TOL = 12   # tight: only near-exact background is keyed out
PAD = 6          # breathing room around each crop

# Two segmentation strategies, chosen per sheet because neither wins everywhere:
#
# "blob"  - connected components against the background (segment.segment). Correct
#           for sheets where characters float at irregular positions. On a regular
#           grid it silently *merges* neighbours that touch.
# "band"  - split on background gutters: find horizontal gutters to get rows, then
#           re-run the same split per row to get that row's cells. Correct for the
#           gridded sheets, and it is the only thing that recovers x2's ragged
#           13-tile bottom row. On free-floating sheets it *over-splits*, slicing a
#           single character wherever a cream stripe crosses it (mascot -> 3 pieces).
#
# Counts were checked against the sheets by eye; together they come to 505 tiles.
BAND_SHEETS = {
    "celebrations3", "achievements5", "celebrations7", "celebrations2",
    "scenes1", "celebrations", "celebrations4", "x", "x2", "celebrations9",
    "achievements2",
}

GUTTER_BG = 0.88   # a row/col this empty of ink is a gutter
GUTTER_RUN = 2     # ...and it has to stay empty for this many px
MIN_CELL = 60      # a band thinner than this is a stray, not a tile


def _bands(bg_profile, total):
    """Content spans between background gutters, as (start, end) pairs."""
    runs, start = [], None
    for i, empty in enumerate(bg_profile > GUTTER_BG):
        if empty and start is None:
            start = i
        elif not empty and start is not None:
            runs.append((start, i))
            start = None
    if start is not None:
        runs.append((start, len(bg_profile)))

    cuts = [0] + [(a + b) // 2 for a, b in runs if b - a >= GUTTER_RUN] + [total]
    return [(cuts[i], cuts[i + 1]) for i in range(len(cuts) - 1)
            if cuts[i + 1] - cuts[i] >= MIN_CELL]


# How far past its band a tile may reach. A clipped extremity sits just beyond
# the cut (the band edge is the middle of a gutter), so this only has to cover
# half a gutter plus the overhang - Sinterklaas' mitre needs 16px. Anything
# larger starts reaching the *next row's* character, which the slab test below
# will not catch when that neighbour is narrower than this tile.
EXTEND_MAX = 30


RECLAIM_SCALE = 4     # flood runs on a 1/4 mask; plenty for a 80px reach
RECLAIM_SLAB = 0.6    # new ink wider than this share of the tile is a neighbour


def _pool(mask, scale):
    """Max-pool a boolean mask down by `scale`, padding to fit."""
    h, w = mask.shape
    ph, pw = (-h) % scale, (-w) % scale
    if ph or pw:
        mask = np.pad(mask, ((0, ph), (0, pw)))
    return mask.reshape(mask.shape[0] // scale, scale,
                        mask.shape[1] // scale, scale).any(axis=(1, 3))


def _reclaim(ink, box):
    """Extend a band cell to the full extent of the art it actually contains.

    Band edges are global cuts, so a tile taller than its row gets sliced -
    Sinterklaas loses the top of his mitre. The fix has to follow ink that is
    *connected* to this tile: simply growing while the column strip has ink
    walks straight into whatever sits above, because a neighbour usually spans
    the same columns. So flood outward from the cell's own pixels (on a coarse
    mask, which is ample for an 80px reach) and take what the flood reaches.
    """
    x0, y0, x1, y1 = box
    wx0, wy0 = max(0, x0 - EXTEND_MAX), max(0, y0 - EXTEND_MAX)
    wx1, wy1 = min(ink.shape[1], x1 + EXTEND_MAX), min(ink.shape[0], y1 + EXTEND_MAX)

    s = RECLAIM_SCALE
    win = _pool(ink[wy0:wy1, wx0:wx1], s)
    seed = np.zeros_like(win)
    seed[(y0 - wy0) // s:-(-(y1 - wy0) // s), (x0 - wx0) // s:-(-(x1 - wx0) // s)] = True
    seed &= win

    while True:                                   # 8-connected flood, masked to ink
        grown = seed.copy()
        grown[1:, :] |= seed[:-1, :]; grown[:-1, :] |= seed[1:, :]
        grown[:, 1:] |= seed[:, :-1]; grown[:, :-1] |= seed[:, 1:]
        grown[1:, 1:] |= seed[:-1, :-1]; grown[:-1, :-1] |= seed[1:, 1:]
        grown[1:, :-1] |= seed[:-1, 1:]; grown[:-1, 1:] |= seed[1:, :-1]
        grown &= win
        if grown.sum() == seed.sum():
            break
        seed = grown

    if not seed.any():
        return box

    # Accept each side's extension only if it is a narrow protrusion. On a sheet
    # whose cards touch (scenes1, the painterly sheets) the flood has no gap to
    # stop at and bleeds into the neighbour - but that arrives as a slab running
    # the full width of the tile, where a mitre or a raised paw is a thin spike.
    sy0, sy1 = (y0 - wy0) // s, -(-(y1 - wy0) // s)
    sx0, sx1 = (x0 - wx0) // s, -(-(x1 - wx0) // s)
    ys, xs = np.where(seed)

    def edge(lo, hi, strip, span):
        """Extended bound, or the original if the new ink is slab-shaped."""
        if strip.size == 0 or not strip.any():
            return lo
        return lo if strip.any(axis=0).sum() > RECLAIM_SLAB * span else hi

    top    = edge(sy0, ys.min(),      seed[ys.min():sy0, :], sx1 - sx0)
    bottom = edge(sy1, ys.max() + 1,  seed[sy1:ys.max() + 1, :], sx1 - sx0)
    left   = edge(sx0, xs.min(),      seed[:, xs.min():sx0].T, sy1 - sy0)
    right  = edge(sx1, xs.max() + 1,  seed[:, sx1:xs.max() + 1].T, sy1 - sy0)

    return (wx0 + left * s, wy0 + top * s, wx0 + right * s, wy0 + bottom * s)


def band_segment(sheet):
    """Grid-aware segmentation: rows from gutters, then cells within each row."""
    im = Image.open(f"{segment.SRC}/{sheet}.png").convert("RGB")
    a = np.array(im)
    bg = segment.background_colour(a)
    ink = segment.ink_mask(a, bg)

    boxes = []
    for y0, y1 in _bands(1 - ink.mean(axis=1), ink.shape[0]):
        row = ink[y0:y1]
        for x0, x1 in _bands(1 - row.mean(axis=0), ink.shape[1]):
            ys, xs = np.where(row[:, x0:x1])          # tighten onto the actual art
            if len(ys) == 0:
                continue
            tight = (x0 + xs.min(), y0 + ys.min(), x0 + xs.max() + 1, y0 + ys.max() + 1)
            boxes.append(_reclaim(ink, tight))
    return im, bg, boxes


def slice_sheet(sheet):
    return band_segment(sheet) if sheet in BAND_SHEETS else segment.segment(sheet)


def key_alpha(rgb, bg):
    """Make border-connected background transparent, leaving interiors intact."""
    a = np.array(rgb).astype(np.int16)
    bgm = np.abs(a - np.array(bg, dtype=np.int16)).max(axis=2) <= ALPHA_TOL
    seed = np.zeros_like(bgm)
    seed[0, :], seed[-1, :] = bgm[0, :], bgm[-1, :]
    seed[:, 0], seed[:, -1] = bgm[:, 0], bgm[:, -1]
    while True:
        grown = seed.copy()
        grown[1:, :] |= seed[:-1, :]
        grown[:-1, :] |= seed[1:, :]
        grown[:, 1:] |= seed[:, :-1]
        grown[:, :-1] |= seed[:, 1:]
        grown &= bgm
        if grown.sum() == seed.sum():
            break
        seed = grown
    out = rgb.convert("RGBA")
    alpha = np.where(seed, 0, 255).astype(np.uint8)
    out.putalpha(Image.fromarray(alpha))
    return out


ART_DENSITY = 0.50   # rows this full of ink are art; caption text peaks near 0.44
GAP_DENSITY = 0.02   # a near-empty row separating art from text


def art_bounds(mask_box):
    """Rows spanned by the art, excluding baked caption text above or below.

    Measured profile: art rows run 0.50-0.98 ink density, caption rows peak at
    0.44, and the two are always separated by one or two near-empty rows. So
    walk out from the solid art core and stop at the first gap in each
    direction - which also drops any caption bleeding in from the row above.
    """
    d = mask_box.sum(axis=1) / mask_box.shape[1]
    core = [i for i, v in enumerate(d) if v > ART_DENSITY]
    if not core:
        return None
    top, bottom = 0, len(d)
    for i in range(core[0], -1, -1):
        if d[i] <= GAP_DENSITY:
            top = i + 1
            break
    for i in range(core[-1], len(d)):
        if d[i] <= GAP_DENSITY:
            bottom = i
            break
    return top, bottom


def build():
    os.makedirs(THUMBS, exist_ok=True)
    for d in (CROPS, THUMBS):
        for f in os.listdir(d):
            if os.path.isfile(f"{d}/{f}"):
                os.remove(f"{d}/{f}")

    segment.MERGE_GAP = 40
    tiles = []
    for sheet, (tier, note) in SHEETS.items():
        im, bg, boxes = slice_sheet(sheet)
        full = np.array(im)
        mask = segment.ink_mask(full, bg)
        for i, (x0, y0, x1, y1) in enumerate(boxes):
            x0p, y0p = max(0, x0 - PAD), max(0, y0 - PAD)
            x1p, y1p = min(im.width, x1 + PAD), min(im.height, y1 + PAD)
            crop = im.crop((x0p, y0p, x1p, y1p))

            caption_img = None
            if sheet == "x2":
                bounds = art_bounds(mask[y0:y1, x0:x1])
                if bounds is not None:
                    top, bottom = bounds
                    # crop coords are offset by PAD relative to the mask box
                    art_top, art_bottom = top + PAD, bottom + PAD
                    if crop.height - art_bottom > 8:
                        caption_img = crop.crop((0, art_bottom, crop.width, crop.height))
                    crop = crop.crop((0, art_top, crop.width, art_bottom))

            tid = f"{sheet}-{i:02d}"
            if tier in ("A", "C"):
                crop = key_alpha(crop, bg)
            crop.save(f"{CROPS}/{tid}.png")

            thumb = crop.copy()
            thumb.thumbnail((THUMB_PX, THUMB_PX), Image.LANCZOS)
            thumb.save(f"{THUMBS}/{tid}.webp", quality=82, method=4)

            rec = {
                "id": tid, "sheet": sheet, "tier": tier, "note": note,
                "w": crop.width, "h": crop.height,
                "box": [int(x0), int(y0), int(x1), int(y1)],
            }
            if caption_img is not None:
                caption_img.save(f"{CROPS}/{tid}-cap.png")
                rec["captionImg"] = f"{tid}-cap.png"
            tiles.append(rec)
        print(f"{sheet:16s} {tier}  {len(boxes):3d} tiles")

    # Crop filenames are stable across rebuilds (so review verdicts survive), which
    # means the browser would happily serve the previous cut from cache. Stamp the
    # build so the page can bust it.
    with open(f"{OUT}/tiles.js", "w") as fh:
        fh.write(f"window.BUILD = {int(time.time())};\n")
        fh.write("window.TILES = " + json.dumps(tiles, indent=1) + ";\n")
    print(f"\n{len(tiles)} tiles -> crops/  +  tiles.js")


if __name__ == "__main__":
    build()
