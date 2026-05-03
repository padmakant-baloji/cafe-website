/* eslint-disable no-restricted-globals */

const PRECACHE = 'baloji-pwa-cache-v6';
const RUNTIME = 'baloji-pwa-runtime-v1';

self.addEventListener('install', (event) => {
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
    '/menu.json',
    '/fallback-menu.json',
    '/images/logo/pwa-192.png',
    '/images/logo/pwa-512.png',
    '/images/logo/pwa-maskable-512.png',
    '/images/logo/logo-small.png'
  ];

  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(PRECACHE);
        await cache.addAll(assets);
      } catch {
        // Some assets may 404 in dev; ignore to keep SW install robust.
      }
      self.skipWaiting();
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
            if (k === PRECACHE || k === RUNTIME) return Promise.resolve();
            if (k.startsWith('baloji-pwa-cache-') || k.startsWith('baloji-pwa-runtime-')) {
              return caches.delete(k);
            }
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

/**
 * Cache-first for same-origin static assets (JS/CSS/images), update in background.
 * Skips navigations and API so HTML and JSON stay fresh.
 */
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (event.request.mode === 'navigate') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(RUNTIME);
      const cached = await cache.match(event.request);

      if (cached) {
        fetch(event.request)
          .then((response) => {
            if (response && response.ok) {
              cache.put(event.request, response.clone());
            }
          })
          .catch(() => {});
        return cached;
      }

      try {
        const response = await fetch(event.request);
        if (response && response.ok) {
          cache.put(event.request, response.clone());
        }
        return response;
      } catch {
        return cached;
      }
    })()
  );
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
  const data = payload && payload.data && typeof payload.data === 'object' ? payload.data : {};

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      data,
      renotify: true,
      icon: '/images/logo/pwa-192.png',
      badge: '/images/logo/pwa-192.png'
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url =
    event.notification && event.notification.data && event.notification.data.url
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
