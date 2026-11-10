// Thin wrapper around the OpenNext worker. It only adds two things for /_next/image:
//   1. Workers Cache for transformed responses (OpenNext's stock handler has none).
//   2. A safe fallback: if the Images binding throws, serve the original image instead of a 500.
// Everything else is passed straight to the OpenNext worker unchanged.
import worker from './.open-next/worker.js';

export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from './.open-next/worker.js';

const ONE_YEAR = 'public, max-age=31536000, immutable';
const ONE_DAY = 'public, max-age=86400';
const FALLBACK_CC = 'public, max-age=60'; // short, so the browser retries the resized version soon

// Which encoded variant the stock handler will produce for this Accept header. Part of the cache key so that
// different formats can never share an entry.
function formatVariant(accept) {
  if (accept.includes('image/avif')) return 'avif';
  if (accept.includes('image/webp')) return 'webp';
  return 'orig';
}

function cacheKeyFor(url, request) {
  const key = new URL(url.origin + url.pathname);
  key.searchParams.set('url', url.searchParams.get('url') ?? '');
  key.searchParams.set('w', url.searchParams.get('w') ?? '');
  key.searchParams.set('q', url.searchParams.get('q') ?? '');
  key.searchParams.set('fmt', formatVariant(request.headers.get('Accept') ?? ''));
  return new Request(key.toString(), { method: 'GET' });
}

// Test-only: a var that makes the Images binding fail. Never set in wrangler.preview.jsonc.
function withTestMode(env) {
  if (env.IMAGES_TEST_MODE !== 'fail') return env;
  const failing = {
    input() {
      return {
        transform() {
          return {
            output() {
              return Promise.reject(new Error('IMAGES_TEST_MODE: simulated transformation failure'));
            },
          };
        },
      };
    },
  };
  return { ...env, IMAGES: failing };
}

function tag(response, headers) {
  const out = new Response(response.body, response);
  for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
  return out;
}

async function handleImage(request, env, ctx, url) {
  const cache = caches.default;
  const key = cacheKeyFor(url, request);

  const hit = await cache.match(key);
  if (hit) return tag(hit, { 'x-img-source': 'workers-cache' });

  let response;
  try {
    response = await worker.fetch(request, withTestMode(env), ctx);
  } catch (e) {
    console.error('image transformation failed, serving original:', e instanceof Error ? e.message : e);
    // Same handler with the binding removed: it validates the URL exactly as before and returns the unmodified original.
    const fallback = await worker.fetch(request, { ...env, IMAGES: undefined }, ctx);
    if (!fallback.ok) return fallback;
    return tag(fallback, { 'Cache-Control': FALLBACK_CC, 'x-img-source': 'original-fallback' });
  }

  const type = response.headers.get('Content-Type') ?? '';
  if (response.status !== 200 || !type.startsWith('image/')) return response;

  const host = new URL(url.searchParams.get('url') ?? 'http://x', url).hostname;
  // R2 object keys are random UUIDs that are never overwritten, so a year is safe. Other hosts get a day.
  const cc = host.endsWith('.r2.dev') ? ONE_YEAR : ONE_DAY;
  const final = tag(response, { 'Cache-Control': cc, 'x-img-source': 'transformed' });
  ctx.waitUntil(cache.put(key, final.clone()));
  return final;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/_next/image') {
      return handleImage(request, env, ctx, url);
    }
    return worker.fetch(request, env, ctx);
  },
};
