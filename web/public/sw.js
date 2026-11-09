// SUUQIYE service worker: shows web pushes and opens the right page when one is tapped.
// Offline shell. Two jobs, both so a visitor never sees an unstyled page:
//  1. /_next/static/* (hashed, immutable CSS/JS/fonts) is kept in a cache and served from it first.
//  2. Page loads try the network (8s), fall back to the last copy of that page, then to /offline.html (self-contained).
// Photos, API calls and everything cross-origin are NOT touched here.
const STATIC_CACHE = 'suuqiye-static-v1';
const PAGE_CACHE = 'suuqiye-pages-v1';
const OFFLINE_URL = '/offline.html';
const KEEP = [STATIC_CACHE, PAGE_CACHE];
const MAX_PAGES = 30;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(PAGE_CACHE)
      .then((c) => c.add(new Request(OFFLINE_URL, { cache: 'reload' })))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});
self.addEventListener('activate', (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('suuqiye-') && !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
);

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then((r) => { clearTimeout(t); resolve(r); }, (e) => { clearTimeout(t); reject(e); });
  });
}

async function staticFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.status === 200) cache.put(request, res.clone()).catch(() => {});
  return res;
}

async function pageFirstNetwork(request, url) {
  const cache = await caches.open(PAGE_CACHE);
  const key = url.origin + url.pathname; // one copy per page, ignoring query strings
  try {
    const res = await withTimeout(fetch(request), 8000);
    const sensitive = url.searchParams.has('code') || url.searchParams.has('access_token') || url.pathname.startsWith('/auth');
    if (res.status === 200 && !sensitive && (res.headers.get('content-type') || '').includes('text/html')) {
      cache.put(key, res.clone()).catch(() => {});
      trimPages(cache);
    }
    return res;
  } catch (e) {
    return (await cache.match(key)) || (await cache.match(OFFLINE_URL)) || Response.error();
  }
}

async function trimPages(cache) {
  const keys = await cache.keys();
  const extra = keys.filter((k) => !k.url.endsWith(OFFLINE_URL));
  for (let i = 0; i < extra.length - MAX_PAGES; i++) await cache.delete(extra[i]);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(staticFirst(request));
  } else if (request.mode === 'navigate') {
    event.respondWith(pageFirstNetwork(request, url));
  }
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'SUUQIYE', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'SUUQIYE';
  const badge =
    'setAppBadge' in self.navigator && typeof data.unread === 'number'
      ? self.navigator.setAppBadge(data.unread).catch(() => {})
      : Promise.resolve();
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, {
        body: data.body || '',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: data.tag || undefined,
        renotify: !!data.tag,
        data: { url: data.url || '/notifications' },
      }),
      badge,
    ])
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = (event.notification.data && event.notification.data.url) || '/notifications';
  const target = new URL(path, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.startsWith(self.location.origin) && 'focus' in c) {
          return c.navigate(target).then((w) => (w || c).focus()).catch(() => self.clients.openWindow(target));
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
