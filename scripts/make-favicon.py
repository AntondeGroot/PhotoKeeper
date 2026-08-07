#!/usr/bin/env python3
"""Packs already-rendered PNGs into a multi-size favicon.ico.

Written by hand because rsvg-convert cannot emit .ico and the project has no
image library installed. The format is small enough not to warrant one: an ICO
is a 6-byte header, one 16-byte directory entry per image, then the image data.
Since Vista every browser accepts PNG data inside that container, so the frames
go in as-is rather than being re-encoded as BMP.

Usage: make-favicon.py out.ico in-16.png in-32.png ...
"""

import struct
import sys

HEADER = "<HHH"  # reserved (0), type (1 = icon), image count
ENTRY = "<BBBBHHII"  # w, h, palette, reserved, planes, bpp, size, offset


def main(out_path: str, png_paths: list[str]) -> None:
    frames = []
    for path in png_paths:
        with open(path, "rb") as handle:
            data = handle.read()
        # Dimensions live in the IHDR chunk: 8-byte signature, 8-byte chunk
        # header, then width and height as big-endian 32-bit ints.
        width, height = struct.unpack(">II", data[16:24])
        frames.append((width, height, data))

    offset = struct.calcsize(HEADER) + struct.calcsize(ENTRY) * len(frames)
    directory, payload = b"", b""
    for width, height, data in frames:
        # 256px is stored as 0 — the field is a single byte.
        directory += struct.pack(
            ENTRY,
            width % 256,
            height % 256,
            0,
            0,
            1,
            32,
            len(data),
            offset,
        )
        payload += data
        offset += len(data)

    with open(out_path, "wb") as handle:
        handle.write(struct.pack(HEADER, 0, 1, len(frames)) + directory + payload)

    sizes = ", ".join(f"{w}x{h}" for w, h, _ in frames)
    print(f"wrote {out_path} ({sizes})")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2:])