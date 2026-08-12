"""Export the chosen tiles into the app as shipped artwork.

Reads `export-set.json` (written by the review page: which tiles are keepers, and
whether each one's accepted restyle or its original crop is the winning version),
downsizes each to a web-sized webp, and writes it into
`frontend/public/celebrations/` under the name the picker will key on.

Everything upstream of this — sheets, crops, full-size regenerated PNGs — stays in
the tool. Only the output of this script ships.

    python3 export_to_app.py [--dry-run]

Safe to re-run: it overwrites by name and reports anything it had to re-encode to
stay under the size budget.
"""
import json
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(HERE, "..", "..", "frontend", "public", "celebrations")

LONG_EDGE = 1080      # plenty for a phone-sized card (see the app-side README)
MAX_BYTES = 200_000   # the budget that README asks for
QUALITY = (85, 78, 70, 62)  # step down until a tile fits

# tile id -> (folder, name). Folder '' is the celebrations root.
#
# Names describe the *occasion*, not the picture, because the filename is what the
# picker keys on — `first-album-printed` survives the art being redrawn, `raccoon
# -with-boxes` does not.
NAMES = {
    # --- calendar-gated -------------------------------------------------------
    "celebrations3-24": ("special-dates", "christmas-gifts"),
    "x3-25": ("special-dates", "christmas-tree"),
    "celebrations3-25": ("special-dates", "sinterklaas"),
    "celebrations3-32": ("special-dates", "syttende-mai"),
    "celebrations3-33": ("special-dates", "midsommar"),
    "celebrations2-17": ("special-dates", "new-year"),
    "x3-05": ("special-dates", "valentine"),
    "x3-22": ("special-dates", "halloween"),
    "x3-27": ("special-dates", "easter"),
    "x3-02": ("special-dates", "autumn"),
    "x3-17": ("special-dates", "winter"),
    # --- the general pool -----------------------------------------------------
    "mascot-00": ("", "mascot"),
    "achievements1-11": ("session-done", "macro-shot"),
    "achievements1-17": ("session-done", "drone-flight"),
    "achievements4-00": ("session-done", "thumbs-up"),
    "achievements4-02": ("session-done", "flexing"),
    "achievements4-03": ("session-done", "crowned"),
    "achievements4-04": ("session-done", "inspecting"),
    "achievements4-05": ("session-done", "sweeping-up"),
    "achievements4-06": ("session-done", "stacking-albums"),
    "achievements4-08": ("session-done", "photo-pile"),
    "achievements4-09": ("session-done", "photo-pile-cheer"),
    "achievements4-10": ("session-done", "album-making"),
    "achievements4-17": ("session-done", "hauling-away"),
    "achievements4-19": ("session-done", "editing"),
    "achievements4-21": ("session-done", "stereo-viewing"),
    "achievements4-22": ("session-done", "cropping"),
    "achievements4-24": ("session-done", "archaeologist"),
    "achievements5-16": ("session-done", "framing"),
    "achievements5-19": ("session-done", "orchestrating"),
    "achievements5-25": ("session-done", "ninja"),
    "celebrations5-07": ("session-done", "darkroom"),
    "celebrations5-16": ("session-done", "gallery-wall"),
    "celebrations8-18": ("session-done", "desk-work"),
    "celebrations8-19": ("session-done", "retouching"),
    "celebrations8-26": ("session-done", "burning-clutter"),
    "reactions1-00": ("session-done", "starstruck"),
    "reactions1-02": ("session-done", "excited"),
    "reactions1-04": ("session-done", "frozen"),
    "reactions2-00": ("session-done", "archive-shelf"),
    "reactions2-01": ("session-done", "browsing-album"),
    "reactions2-02": ("session-done", "overwhelmed"),
    "reactions2-04": ("session-done", "cheering"),
    "reactions2-05": ("session-done", "sleeping"),
    "x3-00": ("session-done", "photographer"),
    "x3-04": ("session-done", "stargazing"),
    "x3-13": ("session-done", "sparkler"),
    "x2-16": ("session-done", "summit"),
    "x-14": ("session-done", "vista"),
    "x-35": ("session-done", "treasured-photo"),
    "celebrations9-02": ("session-done", "archive-king"),
    "achievements2-00": ("session-done", "map-reading"),
    "achievements2-01": ("session-done", "telephoto"),
    "achievements2-05": ("session-done", "panorama"),
    "achievements2-06": ("session-done", "burst-mode"),
    "achievements2-08": ("session-done", "hidden-photographer"),
    "achievements2-09": ("session-done", "field-photographer"),
    "achievements2-16": ("session-done", "well-travelled"),
}


def declined_ids():
    """Tiles whose regeneration was explicitly rejected, per the last Save decisions."""
    path = os.path.join(HERE, "restyle-decisions.json")
    if not os.path.exists(path):
        return set()
    decisions = json.load(open(path)).get("decisions", {})
    return {i for i, d in decisions.items() if d.get("verdict") == "decline"}


def resolve_source(tile_id, declined):
    """The winning version of a tile, decided now rather than when the set was captured.

    `export-set.json` records which tiles are keepers — a review verdict that only exists
    in the browser. It also records a source, but that is a snapshot: paste a better image
    afterwards and it goes stale. So the source is re-derived here from what is actually on
    disk, which is what makes a re-export pick up a fresh regeneration with no extra step.
    """
    restyled = os.path.join(HERE, "restyled", tile_id + ".png")
    if os.path.exists(restyled) and tile_id not in declined:
        return restyled, "restyled"
    return os.path.join(HERE, "crops", tile_id + ".png"), "crop"


def previous_export():
    """name -> source last written, so a re-run can report what changed."""
    path = os.path.join(HERE, "exported.json")
    if not os.path.exists(path):
        return {}
    return {i["name"]: i["source"] for i in json.load(open(path))["images"]}


def encode(im, dest):
    """Save as webp, stepping quality down until it fits the budget."""
    for q in QUALITY:
        im.save(dest, "WEBP", quality=q, method=6)
        if os.path.getsize(dest) <= MAX_BYTES:
            return q, os.path.getsize(dest)
    return QUALITY[-1], os.path.getsize(dest)


def main(dry_run=False):
    tiles = json.load(open(os.path.join(HERE, "export-set.json")))["tiles"]

    missing = [t["id"] for t in tiles if t["id"] not in NAMES]
    if missing:
        sys.exit(f"No name for {len(missing)} keeper(s): {', '.join(missing)}")

    declined = declined_ids()
    before = previous_export()
    used, manifest, oversize, changed = {}, [], [], []
    for tile in tiles:
        folder, name = NAMES[tile["id"]]
        key = f"{folder}/{name}"
        if key in used:
            sys.exit(f"Duplicate name {key}: {used[key]} and {tile['id']}")
        used[key] = tile["id"]

        path, source = resolve_source(tile["id"], declined)
        if name in before and before[name] != source:
            changed.append(f"{key}.webp: {before[name]} -> {source}")

        im = Image.open(path)
        im.thumbnail((LONG_EDGE, LONG_EDGE), Image.LANCZOS)
        out_dir = os.path.join(APP, folder)
        dest = os.path.join(out_dir, name + ".webp")
        if dry_run:
            print(f"  {tile['id']:22s} {source:9s} -> {key}.webp")
            continue
        os.makedirs(out_dir, exist_ok=True)
        quality, size = encode(im, dest)
        if size > MAX_BYTES:
            oversize.append((key, size))
        manifest.append({"name": name, "folder": folder, "tile": tile["id"],
                         "source": source, "bytes": size, "quality": quality})

    if dry_run:
        print(f"\n{len(tiles)} tiles would be exported")
        return

    with open(os.path.join(HERE, "exported.json"), "w") as fh:
        json.dump({"count": len(manifest), "images": manifest}, fh, indent=1)

    total = sum(m["bytes"] for m in manifest)
    restyled = sum(1 for m in manifest if m["source"] == "restyled")
    print(f"{len(manifest)} images -> frontend/public/celebrations/  ({total/1e6:.1f} MB)")
    print(f"{restyled} from a regeneration, {len(manifest) - restyled} from the original crop")
    print(f"largest: {max(m['bytes'] for m in manifest)/1000:.0f} KB")
    for line in changed:
        print(f"  changed  {line}")
    for key, size in oversize:
        print(f"  ! {key} is {size/1000:.0f} KB, over the {MAX_BYTES/1000:.0f} KB budget")


if __name__ == "__main__":
    main(dry_run="--dry-run" in sys.argv)
