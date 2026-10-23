// Pure JPEG metadata inspection / stripping (no dependencies, runs in node, the Worker and tests).
//
// Why this exists: the published watermarked derivative must not leak the seller's location (EXIF GPS) or camera
// data, and it must be UPRIGHT — if a transform ever dropped the EXIF orientation tag without rotating the pixels,
// stripping metadata would leave a sideways photo. The Worker therefore (1) refuses to publish a derivative whose
// pixels still depend on an orientation tag, and (2) removes every metadata segment from the bytes it publishes,
// instead of trusting that the Images binding did so. Both checks read the actual bytes.

export type JpegMetaReport = {
  valid: boolean;
  /** EXIF orientation 1–8; 1 when absent. */
  orientation: number;
  hasExif: boolean;
  hasGps: boolean;
  hasXmp: boolean;
  hasIptc: boolean;
  hasComment: boolean;
};

const EMPTY: JpegMetaReport = { valid: false, orientation: 1, hasExif: false, hasGps: false, hasXmp: false, hasIptc: false, hasComment: false };

type Segment = { marker: number; start: number; end: number }; // [start,end) covers marker + length + payload

function segments(b: Uint8Array): { segs: Segment[]; scanStart: number } | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  const segs: Segment[] = [];
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    let marker = b[i + 1];
    while (marker === 0xff && i + 2 < b.length) { i++; marker = b[i + 1]; } // fill bytes
    if (marker === 0xda) return { segs, scanStart: i }; // SOS: entropy-coded data follows
    if (marker === 0xd9) return { segs, scanStart: i };
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; } // no length
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2 || i + 2 + len > b.length) return null;
    segs.push({ marker, start: i, end: i + 2 + len });
    i += 2 + len;
  }
  return null;
}

const ascii = (b: Uint8Array, at: number, s: string) => s.split('').every((c, k) => b[at + k] === c.charCodeAt(0));

function readExif(b: Uint8Array, s: Segment): { orientation: number; gps: boolean } {
  const base = s.start + 4 + 6; // marker(2) + length(2) + "Exif\0\0"
  if (base + 8 > s.end) return { orientation: 1, gps: false };
  const little = b[base] === 0x49 && b[base + 1] === 0x49;
  if (!little && !(b[base] === 0x4d && b[base + 1] === 0x4d)) return { orientation: 1, gps: false };
  const u16 = (o: number) => (little ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
  const u32 = (o: number) => (little ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0);
  const ifd = base + u32(base + 4);
  if (ifd + 2 > s.end) return { orientation: 1, gps: false };
  const count = u16(ifd);
  let orientation = 1;
  let gps = false;
  for (let k = 0; k < count && ifd + 2 + k * 12 + 12 <= s.end; k++) {
    const e = ifd + 2 + k * 12;
    const tag = u16(e);
    if (tag === 0x0112) {
      const v = u16(e + 8);
      if (v >= 1 && v <= 8) orientation = v;
    }
    if (tag === 0x8825) gps = true; // GPS IFD pointer
  }
  return { orientation, gps };
}

export function jpegMetaReport(b: Uint8Array): JpegMetaReport {
  const parsed = segments(b);
  if (!parsed) return EMPTY;
  const r: JpegMetaReport = { ...EMPTY, valid: true };
  for (const s of parsed.segs) {
    if (s.marker === 0xe1 && ascii(b, s.start + 4, 'Exif\0\0')) {
      r.hasExif = true;
      const ex = readExif(b, s);
      r.orientation = ex.orientation;
      r.hasGps = r.hasGps || ex.gps;
    } else if (s.marker === 0xe1 && ascii(b, s.start + 4, 'http://ns.adobe.com/xap/1.0/')) r.hasXmp = true;
    else if (s.marker === 0xed) r.hasIptc = true;
    else if (s.marker === 0xfe) r.hasComment = true;
  }
  return r;
}

/** True when the pixels still rely on a tag to look upright (anything but orientation 1 / none). */
export const needsRotation = (r: JpegMetaReport) => r.orientation !== 1;

/**
 * Removes EXIF/XMP (APP1), IPTC (APP13), other vendor APPn and comments. Keeps JFIF (APP0), the ICC profile
 * (APP2 — dropping it shifts colours) and Adobe (APP14 — needed to decode some colour spaces). Pixel data is
 * copied byte-for-byte, so this is lossless. Returns null when the input is not a parseable JPEG.
 */
export function stripJpegMetadata(b: Uint8Array): Uint8Array | null {
  const parsed = segments(b);
  if (!parsed) return null;
  const drop = (m: number) => m === 0xfe || (m >= 0xe1 && m <= 0xef && m !== 0xe2 && m !== 0xee);
  const parts: Uint8Array[] = [b.subarray(0, 2)];
  for (const s of parsed.segs) if (!drop(s.marker)) parts.push(b.subarray(s.start, s.end));
  parts.push(b.subarray(parsed.scanStart));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
