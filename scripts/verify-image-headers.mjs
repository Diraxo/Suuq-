// Checks what the CDN actually sends for a published photo: caching headers, content type, and that the resized
// versions are really smaller than the original. Makes plain GET requests to the URL(s) you pass; changes nothing.
//
//   node scripts/verify-image-headers.mjs <public photo URL> [--base https://media.example.com]
//
// With --base (the same value as EXPO_PUBLIC_IMAGE_RESIZE_BASE) it also requests the 400 / 800 / 1600 px versions.
// Exit code 1 if the original lacks a long-lived immutable Cache-Control or any resized version is not smaller.
const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith('http'));
const baseIdx = args.indexOf('--base');
const base = baseIdx >= 0 ? args[baseIdx + 1]?.replace(/\/+$/, '') : '';
if (!url) {
  console.error('usage: node scripts/verify-image-headers.mjs <public photo URL> [--base https://media.example.com]');
  process.exit(2);
}

async function probe(label, target) {
  const started = Date.now();
  const res = await fetch(target, { headers: { Accept: 'image/avif,image/webp,image/*' } });
  const bytes = (await res.arrayBuffer()).byteLength;
  const row = {
    label,
    status: res.status,
    bytes,
    ms: Date.now() - started,
    type: res.headers.get('content-type'),
    cache: res.headers.get('cache-control'),
    cf: res.headers.get('cf-cache-status'),
  };
  console.log(JSON.stringify(row));
  return row;
}

let failed = false;
const original = await probe('original', url);
const maxAge = /max-age=(\d+)/.exec(original.cache ?? '')?.[1];
if (original.status !== 200) failed = true;
if (!maxAge || Number(maxAge) < 2592000 || !/immutable/.test(original.cache ?? '')) {
  console.error('FAIL original: Cache-Control should be public, max-age >= 30 days and immutable, got:', original.cache);
  failed = true;
}
if (base && url.startsWith(`${base}/`)) {
  const path = url.slice(base.length + 1);
  for (const w of [400, 800, 1600]) {
    const r = await probe(`w${w}`, `${base}/cdn-cgi/image/width=${w},quality=75,fit=scale-down,format=auto/${path}`);
    if (r.status !== 200 || r.bytes >= original.bytes) {
      console.error(`FAIL w${w}: status ${r.status}, ${r.bytes} bytes vs original ${original.bytes}`);
      failed = true;
    }
  }
}
process.exit(failed ? 1 : 0);
