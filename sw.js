/* eslint-disable no-restricted-globals */

self.addEventListener('install', (event) => {
  const cacheName = 'baloji-pwa-cache-v2';
  const assets = [
    '/',
    '/menu',
    '/orders',
    '/profile',
    '/styles.css',
    '/push-client.js',
    '/pwa-client.js',
    '/orders.js',
    '/profile.js',
    '/script.js',
    '/sw.js',
    '/manifest.json',
    '/images/logo/logo-large.png',
    '/images/logo/logo-small.png'
  ];

  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(cacheName);
        await cache.addAll(assets);
      } catch {
        // Some assets may 404 in dev; ignore to keep SW install robust.
      }
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(
          keys.map((k) => {
            if (!k.startsWith('baloji-pwa-cache-')) return Promise.resolve();
            if (k !== 'baloji-pwa-cache-v2') return caches.delete(k);
            return Promise.resolve();
          })
        );
      } catch {
        /* ignore */
      }
    })()
  );
  self.clients.claim();
});

self.addEventListener('push', (event) => {
  let payload = null;
  try {
    payload = event.data ? event.data.json() : null;
  } catch {
    payload = null;
  }

  const title = payload && typeof payload.title === 'string' ? payload.title : "Baloji's Cafe";
  const body = payload && typeof payload.body === 'string' ? payload.body : 'You have an order update.';
  const tag = payload && typeof payload.tag === 'string' ? payload.tag : 'order-update';
  const data = (payload && payload.data && typeof payload.data === 'object') ? payload.data : {};

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      data,
      renotify: true
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = event.notification && event.notification.data && event.notification.data.url
    ? String(event.notification.data.url)
    : '/orders';

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = allClients.find((c) => c.url && c.url.includes(url));
      if (existing) {
        existing.focus();
        return;
      }
      await self.clients.openWindow(url);
    })()
  );
});

