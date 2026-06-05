/* eslint-disable no-restricted-globals */

const PRECACHE = 'baloji-pwa-cache-v12';
const RUNTIME = 'baloji-pwa-runtime-v8';

self.addEventListener('install', (event) => {
  const assets = [
    '/',
    '/menu',
    '/orders',
    '/profile',
    '/download',
    '/styles.css',
    '/pwa-client.js',
    '/review-prompt.js',
    '/header-status.js',
    '/download.js',
    '/orders.js',
    '/profile.js',
    '/script.js',
    '/sw.js',
    '/manifest.json',
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
 * Skips navigations and API. `menu.json` is never cached so the menu/prices stay current.
 */
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (event.request.mode === 'navigate') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (url.pathname === '/menu.json') {
    event.respondWith(fetch(event.request));
    return;
  }

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
