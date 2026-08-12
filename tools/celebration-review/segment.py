"""Segment free-floating characters off a flat-background sprite sheet.

The sheets place characters at irregular positions, so a fixed grid clips them.
Instead: threshold against the background colour, dilate so a character's loose
parts (confetti, scattered photos) merge into one blob, label connected
components on a downscaled mask, then refine each box at full resolution.
"""
import os
import sys
from collections import deque

import numpy as np
from PIL import Image, ImageFilter

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sheets")
SCALE = 4          # downscale factor for the labelling pass
TOL = 26           # per-channel distance from background that counts as ink
DILATE = 0         # max-filter radius on the small mask (0 = off, see MERGE_GAP)
MIN_AREA = 6       # components smaller than this (in small-mask px) are noise
MERGE_GAP = 26     # full-res px; boxes closer than this join (confetti -> character)
MIN_SIDE = 90      # final boxes smaller than this on both sides are discarded


def background_colour(a):
    """Modal colour of the four corner patches."""
    corners = np.concatenate([
        a[:40, :40].reshape(-1, 3), a[:40, -40:].reshape(-1, 3),
        a[-40:, :40].reshape(-1, 3), a[-40:, -40:].reshape(-1, 3),
    ])
    vals, counts = np.unique(corners, axis=0, return_counts=True)
    return vals[counts.argmax()]


def ink_mask(a, bg):
    return (np.abs(a.astype(np.int16) - bg.astype(np.int16)) > TOL).any(axis=2)


def label(small):
    """Connected components (8-connected) via BFS. Returns list of bboxes."""
    h, w = small.shape
    seen = np.zeros_like(small, dtype=bool)
    boxes = []
    for y0 in range(h):
        for x0 in range(w):
            if not small[y0, x0] or seen[y0, x0]:
                continue
            q = deque([(y0, x0)])
            seen[y0, x0] = True
            n, miny, maxy, minx, maxx = 0, y0, y0, x0, x0
            while q:
                y, x = q.popleft()
                n += 1
                miny, maxy = min(miny, y), max(maxy, y)
                minx, maxx = min(minx, x), max(maxx, x)
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        ny, nx = y + dy, x + dx
                        if 0 <= ny < h and 0 <= nx < w and small[ny, nx] and not seen[ny, nx]:
                            seen[ny, nx] = True
                            q.append((ny, nx))
            if n >= MIN_AREA:
                boxes.append((minx, miny, maxx, maxy, n))
    return boxes


def segment(sheet):
    im = Image.open(f"{SRC}/{sheet}.png").convert("RGB")
    a = np.array(im)
    bg = background_colour(a)
    mask = ink_mask(a, bg)

    mimg = Image.fromarray((mask * 255).astype(np.uint8))
    small = mimg.resize((mimg.width // SCALE, mimg.height // SCALE), Image.BOX)
    small = small.filter(ImageFilter.MaxFilter(DILATE * 2 + 1))
    smask = np.array(small) > 32

    boxes = []
    for minx, miny, maxx, maxy, _ in label(smask):
        # refine against the full-resolution mask inside the coarse box
        x0, y0 = max(0, minx * SCALE - SCALE), max(0, miny * SCALE - SCALE)
        x1, y1 = min(a.shape[1], (maxx + 2) * SCALE), min(a.shape[0], (maxy + 2) * SCALE)
        sub = mask[y0:y1, x0:x1]
        ys, xs = np.where(sub)
        if len(ys) == 0:
            continue
        boxes.append((x0 + xs.min(), y0 + ys.min(), x0 + xs.max() + 1, y0 + ys.max() + 1))
    boxes = absorb_small(boxes)
    boxes.sort(key=lambda b: (round(b[1] / 100), b[0]))   # reading order
    return im, bg, boxes


def is_large(b):
    return (b[2] - b[0]) >= MIN_SIDE and (b[3] - b[1]) >= MIN_SIDE


def gap(a, b):
    return (max(b[0] - a[2], a[0] - b[2], 0), max(b[1] - a[3], a[1] - b[3], 0))


def absorb_small(boxes):
    """Grow each large box to swallow nearby small fragments (confetti, sparkles).

    Two large boxes are never merged, so neighbouring characters stay separate
    however close they sit.
    """
    large = [list(b) for b in boxes if is_large(b)]
    small = [b for b in boxes if not is_large(b)]
    if not large:
        return [tuple(b) for b in boxes]
    for s in small:
        best, best_d = None, None
        for L in large:
            gx, gy = gap(L, s)
            if gx < MERGE_GAP and gy < MERGE_GAP:
                d = gx + gy
                if best_d is None or d < best_d:
                    best, best_d = L, d
        if best is not None:
            best[0], best[1] = min(best[0], s[0]), min(best[1], s[1])
            best[2], best[3] = max(best[2], s[2]), max(best[3], s[3])
    return [tuple(b) for b in large]


def overlay(sheet, out_path):
    """Draw detected boxes on the sheet so the segmentation can be eyeballed."""
    from PIL import ImageDraw
    im, _, boxes = segment(sheet)
    im = im.copy()
    d = ImageDraw.Draw(im)
    for i, (x0, y0, x1, y1) in enumerate(boxes):
        d.rectangle([x0, y0, x1, y1], outline=(220, 30, 30), width=3)
        d.text((x0 + 5, y0 + 3), str(i), fill=(220, 30, 30))
    im.save(out_path)
    return len(boxes)


def sweep(sheet):
    """Try parameter combinations and report object counts, to find the knee."""
    global TOL, DILATE
    print(f"\n{sheet}")
    print("  tol dil  objects")
    for tol in (18, 26, 34, 44):
        row = []
        for dil in (0, 1, 2, 3):
            TOL, DILATE = tol, dil
            try:
                _, _, boxes = segment(sheet)
                row.append(f"{len(boxes):4d}")
            except Exception:
                row.append("  ??")
        print(f"  {tol:3d}     " + " ".join(row) + "   (dil 0/1/2/3)")


if __name__ == "__main__":
    mode, sheets = sys.argv[1], sys.argv[2:]
    if mode == "sweep":
        for sheet in sheets:
            sweep(sheet)
    else:
        for sheet in [mode] + sheets:
            _, bg, boxes = segment(sheet)
            sizes = [f"{x1-x0}x{y1-y0}" for x0, y0, x1, y1 in boxes]
            print(f"{sheet:16s} bg={tuple(bg)}  objects={len(boxes)}")
            print(f"                 {' '.join(sizes)}")
