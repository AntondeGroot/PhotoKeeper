/**
 * Losslessly removes metadata segments (EXIF/IPTC/XMP/ICC/Adobe/comments) from a JPEG, keeping the
 * pixels — and so the signature — byte-identical. Mirrors `jpegtran -copy none`: walks the marker
 * segments before the scan, drops APP1–APP15 + COM (keeps the standard JFIF APP0), then copies the
 * compressed scan through to EOI verbatim. Non-JPEGs are returned unchanged. Used by the lab's frame
 * export so curated test fixtures carry no original metadata.
 */
export async function stripJpegMetadata(blob: Blob): Promise<Blob> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  if (buf.length < 2 || buf[0] !== 0xff || buf[1] !== 0xd8) return blob;

  const keep: [number, number][] = [[0, 2]]; // SOI
  let i = 2;
  while (i + 1 < buf.length) {
    const marker = buf[i + 1];
    if (buf[i] !== 0xff || marker === 0xff) {
      i++; // padding / resync
    } else if (marker === 0xda || marker === 0xd9) {
      keep.push([i, buf.length - i]); // SOS (scan to end) or EOI — copy the rest verbatim
      break;
    } else if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      keep.push([i, 2]); // standalone marker, no length
      i += 2;
    } else {
      const segLen = 2 + ((buf[i + 2] << 8) | buf[i + 3]);
      const drop = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe; // APP1–APP15, COM
      if (!drop) keep.push([i, segLen]);
      i += segLen;
    }
  }

  const total = keep.reduce((sum, [, len]) => sum + len, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const [off, len] of keep) {
    out.set(buf.subarray(off, off + len), pos);
    pos += len;
  }
  return new Blob([out], { type: 'image/jpeg' });
}
