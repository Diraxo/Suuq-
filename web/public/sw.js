// SUUQIYE service worker: shows web pushes and opens the right page when one is tapped.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

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
