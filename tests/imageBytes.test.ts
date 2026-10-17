import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkImageBytes,
  describeImageRejection,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
  sniffImage,
} from '../supabase/functions/_shared/imageBytes';
import { isAllowedFolder, isOwnedKey } from '../supabase/functions/_shared/uploadPaths';

// All fixtures are small synthetic byte arrays built here — nothing is read
// from disk, nothing is executed or rendered.

const bytes = (...parts: (number | string | number[] | Uint8Array)[]): Uint8Array => {
  const out: number[] = [];
  for (const p of parts) {
    if (typeof p === 'number') out.push(p);
    else if (typeof p === 'string') for (const ch of p) out.push(ch.charCodeAt(0) & 0xff);
    else out.push(...p);
  }
  return Uint8Array.from(out);
};
const be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const le32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
const le24 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff];

function jpeg(width = 800, height = 600, opts: { eoi?: boolean; trailing?: Uint8Array } = {}): Uint8Array {
  const parts: (number | string | number[] | Uint8Array)[] = [
    [0xff, 0xd8],
    [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00], // APP0 JFIF
    [0xff, 0xc0, 0x00, 0x11, 0x08, ...be16(height), ...be16(width), 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01], // SOF0
    [0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00], // SOS
    [0x12, 0x34, 0x56, 0x78, 0x9a],
  ];
  if (opts.eoi !== false) parts.push([0xff, 0xd9]);
  if (opts.trailing) parts.push(opts.trailing);
  return bytes(...parts);
}

function png(width = 800, height = 600, opts: { iend?: boolean } = {}): Uint8Array {
  const parts: (number | string | number[])[] = [
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    be32(13), 'IHDR', be32(width), be32(height), [8, 2, 0, 0, 0], be32(0),
    be32(4), 'IDAT', [1, 2, 3, 4], be32(0),
  ];
  if (opts.iend !== false) parts.push(be32(0), 'IEND', [0xae, 0x42, 0x60, 0x82]);
  return bytes(...parts);
}

function webp(width = 800, height = 600): Uint8Array {
  const body = bytes('WEBP', 'VP8X', le32(10), [0, 0, 0, 0], le24(width - 1), le24(height - 1));
  return bytes('RIFF', le32(body.length), body);
}

const heic = () => bytes(be32(24), 'ftyp', 'heic', [0, 0, 0, 0], 'mif1heic');

// ── Valid files ──────────────────────────────────────────────────────────────
test('valid JPEG, PNG, WebP and HEIC are accepted with their real format and dimensions', () => {
  assert.deepEqual(checkImageBytes(jpeg(800, 600)), { ok: true, info: { format: 'jpeg', width: 800, height: 600 } });
  assert.deepEqual(checkImageBytes(png(640, 480)), { ok: true, info: { format: 'png', width: 640, height: 480 } });
  assert.deepEqual(checkImageBytes(webp(1024, 768)), { ok: true, info: { format: 'webp', width: 1024, height: 768 } });
  assert.deepEqual(checkImageBytes(heic()), { ok: true, info: { format: 'heic' } });
});

// ── Non-images renamed to .jpg/.png (the file name is never even an input) ──
test('text, JSON, scripts, HTML, SVG, PDF, GIF, ZIP and video bytes are rejected', () => {
  const samples: Record<string, Uint8Array> = {
    'text file renamed .jpg': bytes('hello, I am definitely a photo'),
    'script renamed .png': bytes('<script>alert(document.cookie)</script>'),
    'json renamed .jpg': bytes('{"image":"nope","a":[1,2,3]}'),
    html: bytes('<!doctype html><html><body>hi</body></html>'),
    svg: bytes('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>'),
    'svg with xml prolog': bytes('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>'),
    pdf: bytes('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF'),
    gif: bytes('GIF89a', [1, 0, 1, 0, 0, 0, 0], ';'),
    zip: bytes('PK', [3, 4], 'x'.repeat(60)),
    'mp4 video': bytes(be32(32), 'ftyp', 'isom', [0, 0, 2, 0], 'isomiso2avc1mp41'),
    'quicktime video': bytes(be32(20), 'ftyp', 'qt  ', [0, 0, 0, 0], 'qt  '),
    'windows exe': bytes('MZ', [0x90, 0, 3, 0], 'x'.repeat(60)),
    'bare 3 random bytes': bytes(1, 2, 3),
  };
  for (const [name, data] of Object.entries(samples)) {
    const r = checkImageBytes(data);
    assert.equal(r.ok, false, name);
    if (!r.ok) assert.equal(r.reason, 'not-an-image', name);
    assert.equal(sniffImage(data), null, name);
  }
});

test('empty file is rejected', () => {
  assert.deepEqual(checkImageBytes(new Uint8Array(0)), { ok: false, reason: 'empty' });
});

test('corrupt and truncated images are rejected', () => {
  const full = jpeg();
  assert.deepEqual(checkImageBytes(full.slice(0, full.length - 2)), { ok: false, reason: 'truncated' }, 'JPEG missing EOI');
  assert.deepEqual(checkImageBytes(full.slice(0, 20)).ok, false, 'JPEG cut inside the headers');
  const corruptMarker = full.slice();
  corruptMarker[2] = 0x00; // SOI not followed by a marker
  assert.equal(checkImageBytes(corruptMarker).ok, false);
  assert.deepEqual(checkImageBytes(png(800, 600, { iend: false })), { ok: false, reason: 'truncated' }, 'PNG without IEND');
  assert.equal(checkImageBytes(png().slice(0, 30)).ok, false, 'PNG cut mid-IHDR');
  const w = webp();
  assert.deepEqual(checkImageBytes(w.slice(0, 30)).ok, true, 'a full-size webp is fine');
  const cutWebp = bytes('RIFF', le32(5000), w.slice(8));
  assert.deepEqual(checkImageBytes(cutWebp), { ok: false, reason: 'truncated' }, 'WebP whose RIFF size exceeds the file');
});

test('a JPEG with a payload appended after EOI (polyglot) is rejected', () => {
  const polyglot = jpeg(800, 600, { trailing: bytes('<script>alert(1)</script>') });
  const r = checkImageBytes(polyglot);
  assert.equal(r.ok, false);
  // zero padding after EOI is tolerated
  assert.equal(checkImageBytes(jpeg(800, 600, { trailing: new Uint8Array(16) })).ok, true);
});

test('oversized files and extreme dimensions are rejected (decompression-bomb guard)', () => {
  const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
  big.set(jpeg().slice(0, 10));
  assert.deepEqual(checkImageBytes(big), { ok: false, reason: 'too-large' });
  assert.deepEqual(checkImageBytes(jpeg(), { maxBytes: 10 }), { ok: false, reason: 'too-large' });

  assert.deepEqual(checkImageBytes(jpeg(65535, 65535)), { ok: false, reason: 'bad-dimensions' });
  assert.deepEqual(checkImageBytes(png(MAX_IMAGE_DIMENSION + 1, 100)), { ok: false, reason: 'bad-dimensions' });
  assert.deepEqual(checkImageBytes(jpeg(0, 600)), { ok: false, reason: 'bad-dimensions' });
  assert.deepEqual(checkImageBytes(jpeg(12000, 9000)), { ok: false, reason: 'too-many-pixels' });
  assert.equal(checkImageBytes(webp(20000, 20000)).ok, false);
  assert.equal(checkImageBytes(jpeg(4000, 3000)).ok, true, 'a normal 12 MP phone photo is fine');
});

test('format allowlist: the storage verifier only accepts JPEG', () => {
  assert.deepEqual(checkImageBytes(png(), { allowed: ['jpeg'] }), { ok: false, reason: 'format-not-allowed' });
  assert.deepEqual(checkImageBytes(webp(), { allowed: ['jpeg'] }), { ok: false, reason: 'format-not-allowed' });
  assert.equal(checkImageBytes(jpeg(), { allowed: ['jpeg'] }).ok, true);
});

test('mixed selection: valid and invalid files are judged independently', () => {
  const files = [jpeg(), bytes('not an image'), png(), new Uint8Array(0), jpeg(800, 600, { eoi: false })];
  assert.deepEqual(
    files.map((f) => checkImageBytes(f).ok),
    [true, false, true, false, false]
  );
});

test('rejection messages are friendly and never leak internals', () => {
  for (const reason of ['empty', 'too-large', 'not-an-image', 'format-not-allowed', 'truncated', 'bad-dimensions', 'too-many-pixels'] as const) {
    const m = describeImageRejection(reason);
    assert.ok(m.length > 10 && !/error|exception|stack/i.test(m), reason);
  }
});

// ── Upload path / ownership rules used by r2-presign and r2-verify-images ───
const ME = '11111111-2222-4333-8444-555555555555';
const VICTIM = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const FILE = '0f0f0f0f-1111-4222-8333-444444444444.jpg';

test('presign folders: only the caller’s own, known layouts are allowed', () => {
  for (const ok of [`listings/${ME}`, `listings/${ME}/1718000000000`, `avatars/${ME}`, `business/${ME}/logo`, `business/${ME}/banner`]) {
    assert.equal(isAllowedFolder(ok, ME), true, ok);
  }
  for (const bad of [
    `listings/${VICTIM}`,
    `listings/${VICTIM}/${ME}`,
    `x/${ME}/../../listings/${VICTIM}`, // traversal that still "contains" the caller's id
    `listings/${ME}/../${VICTIM}`,
    `listings/${ME}/..`,
    `listings/${ME}//x`,
    `listings/${ME}/a/b`,
    `listings/${ME}/`,
    `avatars/${ME}/extra`,
    `business/${ME}/evil`,
    `chat/${ME}`,
    `chat/conv_123/${ME}`, // chat is text-only: no upload folder
    `chat/a/b/${ME}`,
    `other/${ME}`,
    `${ME}`,
    `listings/${ME}/%2e%2e`,
    `listings/${ME}/a b`,
    '',
  ]) {
    assert.equal(isAllowedFolder(bad, ME), false, JSON.stringify(bad));
  }
  assert.equal(isAllowedFolder(`listings/${ME}`, 'not-a-uuid'), false);
  assert.equal(isAllowedFolder(123 as unknown as string, ME), false);
});

test('verify-images keys: must be a generated <uuid>.jpg inside the caller’s own folder', () => {
  assert.equal(isOwnedKey(`listings/${ME}/1718/${FILE}`, ME), true);
  assert.equal(isOwnedKey(`listings/${ME}/${FILE}`, ME), true);
  assert.equal(isOwnedKey(`avatars/${ME}/${FILE}`, ME), true);
  assert.equal(isOwnedKey(`listings/${VICTIM}/${FILE}`, ME), false);
  assert.equal(isOwnedKey(`listings/${ME}/../${VICTIM}/${FILE}`, ME), false);
  assert.equal(isOwnedKey(`listings/${ME}/evil.html`, ME), false);
  assert.equal(isOwnedKey(`listings/${ME}/${FILE.replace('.jpg', '.svg')}`, ME), false);
});
